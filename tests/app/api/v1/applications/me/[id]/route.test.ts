// CANDID-019 Step 2 — GET /api/v1/applications/me/[id] 라우터 통합 테스트.

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/my-page/detail-service', () => ({
  getMyApplicationDetail: vi.fn(),
}));

const { requireAuth } = (await import('@/lib/auth/middleware')) as unknown as {
  requireAuth: Mock;
};
const { getMyApplicationDetail } = (await import(
  '@/lib/my-page/detail-service'
)) as unknown as { getMyApplicationDetail: Mock };
const { GET } = await import('@/app/api/v1/applications/me/[id]/route');

const SAMPLE = {
  summary: {
    applicationId: 100,
    applicationNumber: 'A-202605-00001',
    jobPostingId: 1,
    jobTitle: '백엔드 엔지니어',
    currentStage: 'INTERVIEW_1',
    currentStageLabel: '1차 면접',
    result: 'IN_PROGRESS',
    submittedAt: '2026-05-01T00:00:00.000Z',
    withdrawnAt: null,
    lastStatusChangedAt: '2026-05-10T00:00:00.000Z',
  },
  timeline: [],
  interviews: [],
};

function getRequest(): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/applications/me/100', {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ userId: 42 });
  getMyApplicationDetail.mockResolvedValue(SAMPLE);
});

describe('GET /api/v1/applications/me/[id] — 정상', () => {
  it('200 + PII-free 응답', async () => {
    const response = await GET(getRequest(), { params: { id: '100' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SAMPLE);
    expect(getMyApplicationDetail).toHaveBeenCalledWith(42, 100);
  });
});

describe('GET /api/v1/applications/me/[id] — applicationId 검증', () => {
  it('비-숫자 id → 400 SYS_VALIDATION_FAILED', async () => {
    const response = await GET(getRequest(), { params: { id: 'abc' } });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
    expect(getMyApplicationDetail).not.toHaveBeenCalled();
  });

  it('음수 id → 400', async () => {
    const response = await GET(getRequest(), { params: { id: '-1' } });
    expect(response.status).toBe(400);
    expect(getMyApplicationDetail).not.toHaveBeenCalled();
  });

  it('0 id → 400', async () => {
    const response = await GET(getRequest(), { params: { id: '0' } });
    expect(response.status).toBe(400);
  });
});

describe('GET /api/v1/applications/me/[id] — 인증', () => {
  it('AUTH_TOKEN_INVALID → 401 + 서비스 미호출', async () => {
    requireAuth.mockRejectedValueOnce(new AppError('AUTH_TOKEN_INVALID'));
    const response = await GET(getRequest(), { params: { id: '100' } });
    expect(response.status).toBe(401);
    expect(getMyApplicationDetail).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/applications/me/[id] — 비즈니스 에러 전파', () => {
  it('APP_DRAFT_NOT_FOUND (ownership 위반) → 404', async () => {
    getMyApplicationDetail.mockRejectedValueOnce(new AppError('APP_DRAFT_NOT_FOUND'));
    const response = await GET(getRequest(), { params: { id: '100' } });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe('APP_DRAFT_NOT_FOUND');
  });

  it('예상치 못한 Error → 500 + 스택 비노출', async () => {
    getMyApplicationDetail.mockRejectedValueOnce(new Error('db crash'));
    const response = await GET(getRequest(), { params: { id: '100' } });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe('SYS_INTERNAL_ERROR');
    expect(body).not.toHaveProperty('stack');
  });
});
