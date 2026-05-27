// CANDID-019 Step 1 — GET /api/v1/applications/me 라우터 통합 테스트.

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/my-page/list-service', () => ({
  getMyApplicationsList: vi.fn(),
}));

const { requireAuth } = (await import('@/lib/auth/middleware')) as unknown as {
  requireAuth: Mock;
};
const { getMyApplicationsList } = (await import('@/lib/my-page/list-service')) as unknown as {
  getMyApplicationsList: Mock;
};
const { GET } = await import('@/app/api/v1/applications/me/route');

const EMPTY = { drafts: [], inProgress: [], closed: [] };
const SAMPLE = {
  drafts: [
    {
      draftId: 7,
      jobPostingId: 1,
      jobTitle: '프론트엔드 엔지니어',
      jobStatus: 'OPEN',
      lastSavedAt: '2026-05-20T10:00:00.000Z',
    },
  ],
  inProgress: [
    {
      applicationId: 100,
      applicationNumber: 'A-202605-00001',
      jobPostingId: 2,
      jobTitle: '백엔드 엔지니어',
      currentStage: 'DOC_REVIEW',
      currentStageLabel: '서류 검토 중',
      result: 'IN_PROGRESS',
      submittedAt: '2026-05-01T00:00:00.000Z',
      withdrawnAt: null,
      lastStatusChangedAt: '2026-05-10T00:00:00.000Z',
    },
  ],
  closed: [],
};

function getRequest(): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/applications/me', {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ userId: 42 });
  getMyApplicationsList.mockResolvedValue(EMPTY);
});

describe('GET /api/v1/applications/me — 정상', () => {
  it('200 + 빈 응답 + userId 전달', async () => {
    const response = await GET(getRequest(), undefined);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(EMPTY);
    expect(getMyApplicationsList).toHaveBeenCalledWith(42);
  });

  it('200 + 3 섹션 데이터 + 응답 본문 그대로 직렬화', async () => {
    getMyApplicationsList.mockResolvedValueOnce(SAMPLE);
    const response = await GET(getRequest(), undefined);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SAMPLE);
  });
});

describe('GET /api/v1/applications/me — 인증', () => {
  it('AUTH_TOKEN_INVALID → 401', async () => {
    requireAuth.mockRejectedValueOnce(new AppError('AUTH_TOKEN_INVALID'));
    const response = await GET(getRequest(), undefined);
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('AUTH_TOKEN_INVALID');
    expect(getMyApplicationsList).not.toHaveBeenCalled();
  });

  it('AUTH_TOKEN_EXPIRED → 401', async () => {
    requireAuth.mockRejectedValueOnce(new AppError('AUTH_TOKEN_EXPIRED'));
    const response = await GET(getRequest(), undefined);
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('AUTH_TOKEN_EXPIRED');
  });
});

describe('GET /api/v1/applications/me — 서비스 에러 전파', () => {
  it('예상치 못한 Error → 500 SYS_INTERNAL_ERROR + 스택 비노출', async () => {
    getMyApplicationsList.mockRejectedValueOnce(new Error('db crashed'));
    const response = await GET(getRequest(), undefined);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe('SYS_INTERNAL_ERROR');
    expect(body).not.toHaveProperty('stack');
  });
});

describe('GET /api/v1/applications/me — 표준 7필드 + PII-free', () => {
  it('성공 응답에 PII 패턴(@, phone) 부재', async () => {
    getMyApplicationsList.mockResolvedValueOnce(SAMPLE);
    const response = await GET(getRequest(), undefined);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain('@');
    expect(serialized).not.toMatch(/\d{2,3}-\d{3,4}-\d{4}/);
  });

  it('에러 응답에 timestamp/status/code/message/path/traceId', async () => {
    requireAuth.mockRejectedValueOnce(new AppError('AUTH_TOKEN_INVALID'));
    const response = await GET(getRequest(), undefined);
    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        timestamp: expect.any(String),
        status: 401,
        code: 'AUTH_TOKEN_INVALID',
        message: expect.any(String),
        path: '/api/v1/applications/me',
        traceId: expect.any(String),
      }),
    );
  });
});
