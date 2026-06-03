import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { VirusScanStatus } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { __resetMetricsRegistryForTesting, renderMetrics } from '@/lib/observability/metrics';

// CANDID-016 Step 2 — POST /api/v1/files/resume/confirm route 통합.

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/files/confirm', () => ({
  confirmResumeUpload: vi.fn(),
}));

const { requireAuth } = (await import('@/lib/auth/middleware')) as unknown as {
  requireAuth: Mock;
};
const { confirmResumeUpload } = (await import('@/lib/files/confirm')) as unknown as {
  confirmResumeUpload: Mock;
};
const { POST } = await import('@/app/api/v1/files/resume/confirm/route');

const validBody = {
  draftId: 7,
  storedPath: 'resumes/2026/05/01234567-89ab-cdef-0123-456789abcdef.pdf',
  originalFilename: 'CV.pdf',
  contentType: 'application/pdf',
  fileSize: 1024,
  checksumSha256: '0'.repeat(64),
};

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/files/resume/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireAuth.mockReset();
  confirmResumeUpload.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/v1/files/resume/confirm', () => {
  it('201 + 메타 응답 + private no-store', async () => {
    requireAuth.mockResolvedValue({ userId: 42 });
    confirmResumeUpload.mockResolvedValue({
      id: 99,
      virusScanStatus: VirusScanStatus.PENDING,
      uploadedAt: new Date('2026-05-25T00:10:00Z'),
    });

    const response = await POST(postRequest(validBody), undefined);

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toEqual({
      id: 99,
      virusScanStatus: 'PENDING',
      uploadedAt: '2026-05-25T00:10:00.000Z',
    });
  });

  it('인증 실패 → 401', async () => {
    requireAuth.mockRejectedValue(new AppError('AUTH_TOKEN_INVALID'));
    const response = await POST(postRequest(validBody), undefined);
    expect(response.status).toBe(401);
    expect(confirmResumeUpload).not.toHaveBeenCalled();
  });

  it('zod parse 실패(잘못된 checksum) → 400', async () => {
    requireAuth.mockResolvedValue({ userId: 42 });
    const response = await POST(postRequest({ ...validBody, checksumSha256: 'short' }), undefined);
    expect(response.status).toBe(400);
  });

  it('FILE_ALREADY_EXISTS → 409 (partial UNIQUE 충돌)', async () => {
    requireAuth.mockResolvedValue({ userId: 42 });
    confirmResumeUpload.mockRejectedValue(new AppError('FILE_ALREADY_EXISTS'));
    const response = await POST(postRequest(validBody), undefined);
    expect(response.status).toBe(409);
  });

  it('storedPath 위변조 → 400 SYS_VALIDATION_FAILED', async () => {
    requireAuth.mockResolvedValue({ userId: 42 });
    confirmResumeUpload.mockRejectedValue(new AppError('SYS_VALIDATION_FAILED'));
    const response = await POST(postRequest(validBody), undefined);
    expect(response.status).toBe(400);
  });
});

// CANDID-027 Step 4 — 라우트에 withBusinessMetric('file_upload')가 실제로 배선됐는지 검증
// (HOF 단위 테스트만으로는 라우트 배선 누락/오타 회귀를 잡지 못함 — end-to-end 가시성).
describe('POST /api/v1/files/resume/confirm — 비즈니스 메트릭 배선', () => {
  beforeEach(() => {
    __resetMetricsRegistryForTesting();
  });
  afterEach(() => {
    __resetMetricsRegistryForTesting();
  });

  it('201 성공 시 file_upload success 카운터 증가', async () => {
    requireAuth.mockResolvedValue({ userId: 42 });
    confirmResumeUpload.mockResolvedValue({
      id: 99,
      virusScanStatus: VirusScanStatus.PENDING,
      uploadedAt: new Date('2026-05-25T00:10:00Z'),
    });
    await POST(postRequest(validBody), undefined);
    expect(await renderMetrics()).toContain(
      'candidate_business_event_total{event="file_upload",result="success"} 1',
    );
  });

  it('인증 실패(throw) 시 file_upload failure 카운터 증가', async () => {
    requireAuth.mockRejectedValue(new AppError('AUTH_TOKEN_INVALID'));
    await POST(postRequest(validBody), undefined);
    expect(await renderMetrics()).toContain(
      'candidate_business_event_total{event="file_upload",result="failure"} 1',
    );
  });
});
