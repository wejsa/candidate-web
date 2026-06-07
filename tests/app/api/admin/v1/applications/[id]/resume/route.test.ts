// CANDID-066 Step 2 — GET /api/admin/v1/applications/[id]/resume 라우터 테스트 (RBAC + actor 배선 + 게이팅 변환).
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';

vi.mock('@/lib/auth/require-role', () => ({ requireRole: vi.fn() }));
vi.mock('@/lib/admin/applicants', () => ({ getResumeDownloadForOperator: vi.fn() }));

const { requireRole } = (await import('@/lib/auth/require-role')) as unknown as {
  requireRole: Mock;
};
const { getResumeDownloadForOperator } = (await import('@/lib/admin/applicants')) as unknown as {
  getResumeDownloadForOperator: Mock;
};
const { GET } = await import('@/app/api/admin/v1/applications/[id]/resume/route');

function get(id: string, ua = 'op-ua'): NextRequest {
  return new NextRequest(
    `https://candidate.example.com/api/admin/v1/applications/${id}/resume`,
    { headers: { 'user-agent': ua } },
  );
}
const ctx = (id: string) => ({ params: { id } });

beforeEach(() => {
  vi.resetAllMocks();
  requireRole.mockResolvedValue({ userId: 42, role: 'RECRUITER' });
});

describe('GET /api/admin/v1/applications/[id]/resume', () => {
  it('권한 부족 → 403, 다운로드 서비스 미호출', async () => {
    requireRole.mockRejectedValue(new AppError('AUTH_FORBIDDEN'));
    const res = await GET(get('10'), ctx('10'));
    expect(res.status).toBe(403);
    expect(getResumeDownloadForOperator).not.toHaveBeenCalled();
  });

  it('정상 → 200 + presigned URL/파일명 반환 + actor 배선', async () => {
    getResumeDownloadForOperator.mockResolvedValue({
      url: 'https://s3.example/presigned-get',
      filename: '이력서.pdf',
      expiresAt: new Date('2026-06-07T00:01:00Z'),
    });
    const res = await GET(get('10', 'op-ua'), ctx('10'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe('https://s3.example/presigned-get');
    expect(body.filename).toBe('이력서.pdf');
    expect(getResumeDownloadForOperator.mock.calls[0]![0]).toMatchObject({
      actorUserId: 42,
      applicationId: 10,
      userAgent: 'op-ua',
    });
  });

  it('감염 파일 → 409 FILE_INFECTED (도메인 에러 변환)', async () => {
    getResumeDownloadForOperator.mockRejectedValue(new AppError('FILE_INFECTED'));
    const res = await GET(get('10'), ctx('10'));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('FILE_INFECTED');
  });

  it('첨부 없음 → 404 FILE_NOT_FOUND', async () => {
    getResumeDownloadForOperator.mockRejectedValue(new AppError('FILE_NOT_FOUND'));
    const res = await GET(get('999'), ctx('999'));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('FILE_NOT_FOUND');
  });
});
