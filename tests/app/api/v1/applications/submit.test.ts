import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';
import { IdempotencyRequestMismatchError } from '@/lib/idempotency/store';

// CANDID-018 Step 3 — POST /api/v1/applications 라우터 통합 테스트.
// submitApplication / lookupAndVerify / storeResponse / requireAuth는 mock — 라우터의
// 헤더 검증, 멱등성 분기, 표준 7필드 에러 응답, PII-free 응답 본문만 검증.
// 실 DB 통합 검증은 별도 integration 테스트로 위임 (Phase 4 운영/품질).

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/applications/submit', () => ({
  submitApplication: vi.fn(),
}));
vi.mock('@/lib/idempotency/store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/idempotency/store')>(
    '@/lib/idempotency/store',
  );
  return {
    ...actual,
    lookupAndVerify: vi.fn(),
    storeResponse: vi.fn(),
    hashRequestBody: vi.fn((body: unknown) => `hash:${JSON.stringify(body ?? null)}`),
  };
});

const { requireAuth } = (await import('@/lib/auth/middleware')) as unknown as {
  requireAuth: Mock;
};
const { submitApplication } = (await import('@/lib/applications/submit')) as unknown as {
  submitApplication: Mock;
};
const { lookupAndVerify, storeResponse, hashRequestBody } = (await import(
  '@/lib/idempotency/store'
)) as unknown as {
  lookupAndVerify: Mock;
  storeResponse: Mock;
  hashRequestBody: Mock;
};
const { POST } = await import('@/app/api/v1/applications/route');

const VALID_IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000001';
const ANOTHER_IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000002';
const validBody = { jobPostingId: 42, consent: true };
const successSummary = {
  applicationNumber: 'A-202605-00001',
  submittedAt: '2026-05-27T12:00:00.000Z',
  currentStage: 'SUBMITTED' as const,
};

function postRequest(
  body: unknown,
  options: {
    idempotencyKey?: string | null;
    rawBody?: string;
  } = {},
): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.idempotencyKey !== null && options.idempotencyKey !== undefined) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }
  return new NextRequest('https://candidate.example.com/api/v1/applications', {
    method: 'POST',
    headers,
    body: options.rawBody ?? JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 기본: 인증 통과 (userId=99), 멱등성 miss, submit 성공, store 정상
  requireAuth.mockResolvedValue({ userId: 99 });
  lookupAndVerify.mockResolvedValue(null);
  submitApplication.mockResolvedValue(successSummary);
  storeResponse.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/v1/applications — 정상', () => {
  it('201 + PII-free 응답 + submit/store 호출 인자 검증', async () => {
    const response = await POST(postRequest(validBody, { idempotencyKey: VALID_IDEMPOTENCY_KEY }), undefined);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body).toEqual(successSummary);

    // PII 미포함 회귀 가드 (응답 직렬화에 평문 PII 없음)
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('@'); // email 누출 차단
    expect(bodyStr).not.toMatch(/\d{2}-\d{4}-\d{4}/); // phone 누출 차단

    expect(submitApplication).toHaveBeenCalledTimes(1);
    expect(submitApplication).toHaveBeenCalledWith({ userId: 99, jobPostingId: 42 });

    expect(storeResponse).toHaveBeenCalledTimes(1);
    expect(storeResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 99,
        key: VALID_IDEMPOTENCY_KEY,
        responseJson: successSummary,
        responseStatus: 201,
      }),
    );
  });

  it('jobPostingId가 문자열이어도 zod coerce로 통과', async () => {
    const response = await POST(
      postRequest({ jobPostingId: '7', consent: true }, { idempotencyKey: VALID_IDEMPOTENCY_KEY }),
      undefined,
    );
    expect(response.status).toBe(201);
    expect(submitApplication).toHaveBeenCalledWith({ userId: 99, jobPostingId: 7 });
  });
});

describe('POST /api/v1/applications — 멱등성', () => {
  it('cache hit: lookupAndVerify가 record 반환 → submit/store 호출 없이 cached response', async () => {
    const cached = {
      responseJson: successSummary,
      responseStatus: 201,
      requestHash: `hash:${JSON.stringify(validBody)}`,
      expiresAt: new Date('2026-05-28T12:00:00Z'),
    };
    lookupAndVerify.mockResolvedValueOnce(cached);

    const response = await POST(postRequest(validBody, { idempotencyKey: VALID_IDEMPOTENCY_KEY }), undefined);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual(successSummary);

    expect(submitApplication).not.toHaveBeenCalled();
    expect(storeResponse).not.toHaveBeenCalled();
  });

  it('cache hit는 첫 응답의 status 코드를 그대로 반영 (예: 409 캐시)', async () => {
    const cached = {
      responseJson: { code: 'APP_ALREADY_SUBMITTED', message: '이미 지원한 공고입니다.' },
      responseStatus: 409,
      requestHash: 'hash:cached',
      expiresAt: new Date('2026-05-28T12:00:00Z'),
    };
    lookupAndVerify.mockResolvedValueOnce(cached);

    const response = await POST(postRequest(validBody, { idempotencyKey: VALID_IDEMPOTENCY_KEY }), undefined);
    expect(response.status).toBe(409);
    expect(submitApplication).not.toHaveBeenCalled();
  });

  it('mismatch: 같은 key + 다른 body → 400 SYS_VALIDATION_FAILED + submit 미호출', async () => {
    lookupAndVerify.mockImplementationOnce(() => {
      throw new IdempotencyRequestMismatchError();
    });

    const response = await POST(postRequest(validBody, { idempotencyKey: VALID_IDEMPOTENCY_KEY }), undefined);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
    expect(body.message).toContain('Idempotency-Key');

    expect(submitApplication).not.toHaveBeenCalled();
    expect(storeResponse).not.toHaveBeenCalled();
  });

  it('store P2002는 storeResponse 내부에서 swallow됨 — 라우터 응답에 영향 없음', async () => {
    // storeResponse가 swallow하는 동작이므로 라우터 입장에서는 정상 종료처럼 보임
    storeResponse.mockResolvedValueOnce(undefined);
    const response = await POST(postRequest(validBody, { idempotencyKey: ANOTHER_IDEMPOTENCY_KEY }), undefined);
    expect(response.status).toBe(201);
  });

  it('hashRequestBody는 lookupAndVerify와 동일한 hash를 사용', async () => {
    await POST(postRequest(validBody, { idempotencyKey: VALID_IDEMPOTENCY_KEY }), undefined);
    expect(hashRequestBody).toHaveBeenCalledTimes(1);
    expect(lookupAndVerify).toHaveBeenCalledWith(
      99,
      VALID_IDEMPOTENCY_KEY,
      `hash:${JSON.stringify(validBody)}`,
    );
  });
});

describe('POST /api/v1/applications — Idempotency-Key 검증', () => {
  it('Idempotency-Key 헤더 누락 → 400 SYS_VALIDATION_FAILED', async () => {
    const response = await POST(postRequest(validBody, { idempotencyKey: null }), undefined);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
    expect(body.details).toEqual([
      { field: 'Idempotency-Key', reason: 'header missing' },
    ]);

    // 헤더 누락은 submit 진입 차단
    expect(lookupAndVerify).not.toHaveBeenCalled();
    expect(submitApplication).not.toHaveBeenCalled();
  });

  it('Idempotency-Key 빈 문자열 → 400 SYS_VALIDATION_FAILED', async () => {
    const response = await POST(postRequest(validBody, { idempotencyKey: '' }), undefined);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
  });

  it('Idempotency-Key 36자 미만 → 400 + zod issue details', async () => {
    const response = await POST(postRequest(validBody, { idempotencyKey: 'short' }), undefined);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('Idempotency-Key UUID v4 아님 (v1) → 400', async () => {
    // version 1 UUID 패턴 (timestamp 기반) — regex 통과 못함
    const v1 = 'c5a4d2e0-1111-1111-8000-000000000001';
    const response = await POST(postRequest(validBody, { idempotencyKey: v1 }), undefined);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
  });
});

describe('POST /api/v1/applications — Body 검증', () => {
  it('잘못된 JSON body → 400 SYS_VALIDATION_FAILED', async () => {
    const response = await POST(
      postRequest(undefined, { idempotencyKey: VALID_IDEMPOTENCY_KEY, rawBody: '{not json' }),
      undefined,
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
    expect(body.message).toContain('JSON');
    expect(submitApplication).not.toHaveBeenCalled();
  });

  it('consent: false → 400 SYS_VALIDATION_FAILED (zod parse 실패)', async () => {
    const response = await POST(
      postRequest({ jobPostingId: 42, consent: false }, { idempotencyKey: VALID_IDEMPOTENCY_KEY }),
      undefined,
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
    expect(submitApplication).not.toHaveBeenCalled();
  });

  it('jobPostingId 누락 → 400', async () => {
    const response = await POST(
      postRequest({ consent: true }, { idempotencyKey: VALID_IDEMPOTENCY_KEY }),
      undefined,
    );
    expect(response.status).toBe(400);
  });

  it('jobPostingId 음수 → 400', async () => {
    const response = await POST(
      postRequest({ jobPostingId: -1, consent: true }, { idempotencyKey: VALID_IDEMPOTENCY_KEY }),
      undefined,
    );
    expect(response.status).toBe(400);
  });

  it('strict 위반 (추가 키) → 400', async () => {
    const response = await POST(
      postRequest(
        { jobPostingId: 42, consent: true, extra: 'x' },
        { idempotencyKey: VALID_IDEMPOTENCY_KEY },
      ),
      undefined,
    );
    expect(response.status).toBe(400);
  });
});

describe('POST /api/v1/applications — 인증', () => {
  it('인증 실패 (AUTH_TOKEN_INVALID) → 401 + submit 미호출', async () => {
    requireAuth.mockRejectedValueOnce(new AppError('AUTH_TOKEN_INVALID'));

    const response = await POST(postRequest(validBody, { idempotencyKey: VALID_IDEMPOTENCY_KEY }), undefined);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe('AUTH_TOKEN_INVALID');

    expect(lookupAndVerify).not.toHaveBeenCalled();
    expect(submitApplication).not.toHaveBeenCalled();
  });

  it('Access 토큰 만료 (AUTH_TOKEN_EXPIRED) → 401', async () => {
    requireAuth.mockRejectedValueOnce(new AppError('AUTH_TOKEN_EXPIRED'));

    const response = await POST(postRequest(validBody, { idempotencyKey: VALID_IDEMPOTENCY_KEY }), undefined);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe('AUTH_TOKEN_EXPIRED');
  });
});

describe('POST /api/v1/applications — 비즈니스 에러 전파', () => {
  it('이메일 미인증 (AUTH_EMAIL_NOT_VERIFIED) → 403 + store 미호출', async () => {
    submitApplication.mockRejectedValueOnce(new AppError('AUTH_EMAIL_NOT_VERIFIED'));

    const response = await POST(postRequest(validBody, { idempotencyKey: VALID_IDEMPOTENCY_KEY }), undefined);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe('AUTH_EMAIL_NOT_VERIFIED');

    // 실패는 멱등성 캐시 대상 아님 — 다음 재시도 시 같은 검증 수행
    expect(storeResponse).not.toHaveBeenCalled();
  });

  it('Draft 미존재 (APP_DRAFT_NOT_FOUND) → 404', async () => {
    submitApplication.mockRejectedValueOnce(new AppError('APP_DRAFT_NOT_FOUND'));

    const response = await POST(postRequest(validBody, { idempotencyKey: VALID_IDEMPOTENCY_KEY }), undefined);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe('APP_DRAFT_NOT_FOUND');
  });

  it('마감 (APP_DEADLINE_PASSED) → 422 + store 미호출', async () => {
    submitApplication.mockRejectedValueOnce(new AppError('APP_DEADLINE_PASSED'));

    const response = await POST(postRequest(validBody, { idempotencyKey: VALID_IDEMPOTENCY_KEY }), undefined);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe('APP_DEADLINE_PASSED');
    expect(storeResponse).not.toHaveBeenCalled();
  });

  it('이미 제출 (APP_ALREADY_SUBMITTED) → 409 + store 미호출', async () => {
    submitApplication.mockRejectedValueOnce(new AppError('APP_ALREADY_SUBMITTED'));

    const response = await POST(postRequest(validBody, { idempotencyKey: VALID_IDEMPOTENCY_KEY }), undefined);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe('APP_ALREADY_SUBMITTED');
    expect(storeResponse).not.toHaveBeenCalled();
  });

  it('이력서/필수 필드 미충족 (APP_SUBMIT_INCOMPLETE) → 422', async () => {
    submitApplication.mockRejectedValueOnce(
      new AppError('APP_SUBMIT_INCOMPLETE', {
        details: [{ field: 'resume', reason: '이력서 1+ 업로드 필요' }],
      }),
    );

    const response = await POST(postRequest(validBody, { idempotencyKey: VALID_IDEMPOTENCY_KEY }), undefined);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe('APP_SUBMIT_INCOMPLETE');
    expect(body.details).toEqual([{ field: 'resume', reason: '이력서 1+ 업로드 필요' }]);
  });

  it('예상치 못한 Error → 500 SYS_INTERNAL_ERROR + 스택 트레이스 미노출', async () => {
    submitApplication.mockRejectedValueOnce(new Error('unexpected db crash'));

    const response = await POST(postRequest(validBody, { idempotencyKey: VALID_IDEMPOTENCY_KEY }), undefined);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe('SYS_INTERNAL_ERROR');
    expect(body.message).toBe('서버 내부 오류가 발생했습니다.'); // 카탈로그 기본 메시지만 노출
    expect(body).not.toHaveProperty('stack');
    // 주의: handleApiError가 details[].reason에 err.toString()을 합성하는 동작은
    // CANDID-007 Step 2 결정 사항(운영 환경 디버깅 도움). 평문 PII가 Error.message에 들어가지
    // 않도록 호출 측이 보장해야 함 (BR-PII-01). 본 Route Handler는 도메인 평문 PII를
    // 트랜잭션 외 user.findUnique 결과로만 다루며 Error 객체에 노출하지 않음.
  });
});

describe('POST /api/v1/applications — 표준 7필드 응답 회귀', () => {
  it('에러 응답에 timestamp/status/code/message/path/traceId 필드 포함', async () => {
    submitApplication.mockRejectedValueOnce(new AppError('APP_ALREADY_SUBMITTED'));

    const response = await POST(postRequest(validBody, { idempotencyKey: VALID_IDEMPOTENCY_KEY }), undefined);
    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        timestamp: expect.any(String),
        status: 409,
        code: 'APP_ALREADY_SUBMITTED',
        message: expect.any(String),
        path: '/api/v1/applications',
        traceId: expect.any(String),
      }),
    );
  });
});
