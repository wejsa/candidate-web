import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';

// CANDID-016 Step 2 — POST /api/v1/files/resume/presign route 통합.
// requireAuth + 비즈니스 mock — 라우터의 zod parse + status + Cache-Control 헤더 검증.

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/files/resume', () => ({
  issueResumePresign: vi.fn(),
}));

const { requireAuth } = (await import('@/lib/auth/middleware')) as unknown as {
  requireAuth: Mock;
};
const { issueResumePresign } = (await import('@/lib/files/resume')) as unknown as {
  issueResumePresign: Mock;
};
const { POST } = await import('@/app/api/v1/files/resume/presign/route');

const validBody = {
  draftId: 7,
  originalFilename: 'CV.pdf',
  contentType: 'application/pdf',
  fileSize: 1024,
};

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/files/resume/presign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireAuth.mockReset();
  issueResumePresign.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/v1/files/resume/presign', () => {
  it('200 + presigned 응답 + private no-store', async () => {
    requireAuth.mockResolvedValue({ userId: 42 });
    issueResumePresign.mockResolvedValue({
      uploadUrl: 'https://minio.local/upload?sig=abc',
      storedPath: 'resumes/2026/05/uuid.pdf',
      headers: { 'Content-Type': 'application/pdf' },
      expiresAt: new Date('2026-05-25T00:05:00Z'),
      replacedPaths: [],
    });

    const response = await POST(postRequest(validBody), undefined);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      uploadUrl: 'https://minio.local/upload?sig=abc',
      storedPath: 'resumes/2026/05/uuid.pdf',
      expiresAt: '2026-05-25T00:05:00.000Z',
      replacedPaths: [],
    });
  });

  it('인증 실패 → AUTH_TOKEN_* 표준 응답', async () => {
    requireAuth.mockRejectedValue(new AppError('AUTH_TOKEN_INVALID'));
    const response = await POST(postRequest(validBody), undefined);
    expect(response.status).toBe(401);
    expect(issueResumePresign).not.toHaveBeenCalled();
  });

  it('zod parse 실패 → 400 SYS_VALIDATION_FAILED', async () => {
    requireAuth.mockResolvedValue({ userId: 42 });
    const response = await POST(postRequest({ ...validBody, draftId: -1 }), undefined);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
    expect(issueResumePresign).not.toHaveBeenCalled();
  });

  it('비즈니스 throw FILE_TYPE_NOT_ALLOWED → 422', async () => {
    requireAuth.mockResolvedValue({ userId: 42 });
    issueResumePresign.mockRejectedValue(new AppError('FILE_TYPE_NOT_ALLOWED'));
    const response = await POST(postRequest(validBody), undefined);
    expect(response.status).toBe(422);
  });

  it('비즈니스 throw SYS_DEPENDENCY_UNAVAILABLE → 503 (저장소 미구성)', async () => {
    requireAuth.mockResolvedValue({ userId: 42 });
    issueResumePresign.mockRejectedValue(new AppError('SYS_DEPENDENCY_UNAVAILABLE'));
    const response = await POST(postRequest(validBody), undefined);
    expect(response.status).toBe(503);
  });
});
