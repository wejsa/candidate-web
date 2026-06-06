// CANDID-053 Step 5 — GET /api/admin/v1/job-postings/[id]/applications 라우터 테스트 (RBAC + 쿼리 배선).
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';

vi.mock('@/lib/auth/require-role', () => ({ requireRole: vi.fn() }));
vi.mock('@/lib/admin/applicants', () => ({ listApplicantsByPosting: vi.fn() }));

const { requireRole } = (await import('@/lib/auth/require-role')) as unknown as {
  requireRole: Mock;
};
const { listApplicantsByPosting } = (await import('@/lib/admin/applicants')) as unknown as {
  listApplicantsByPosting: Mock;
};
const { GET } = await import('@/app/api/admin/v1/job-postings/[id]/applications/route');

function get(id: string, query = ''): NextRequest {
  return new NextRequest(
    `https://candidate.example.com/api/admin/v1/job-postings/${id}/applications${query}`,
  );
}
const ctx = (id: string) => ({ params: { id } });

beforeEach(() => {
  vi.resetAllMocks();
  requireRole.mockResolvedValue({ userId: 1, role: 'RECRUITER' });
  listApplicantsByPosting.mockResolvedValue({ items: [], pagination: {} });
});

describe('GET /api/admin/v1/job-postings/[id]/applications', () => {
  it('권한 부족 → 403, 서비스 미호출', async () => {
    requireRole.mockRejectedValue(new AppError('AUTH_FORBIDDEN'));
    const res = await GET(get('7'), ctx('7'));
    expect(res.status).toBe(403);
    expect(listApplicantsByPosting).not.toHaveBeenCalled();
  });

  it('정상 → 200 + page/stage 쿼리를 서비스로 전달', async () => {
    const res = await GET(get('7', '?page=2&stage=INTERVIEW_1'), ctx('7'));
    expect(res.status).toBe(200);
    expect(listApplicantsByPosting.mock.calls[0]![0]).toMatchObject({
      jobPostingId: 7,
      page: 2,
      stage: 'INTERVIEW_1',
    });
  });

  it('쿼리 미지정 → page 기본 1, stage undefined', async () => {
    await GET(get('7'), ctx('7'));
    expect(listApplicantsByPosting.mock.calls[0]![0]).toMatchObject({ jobPostingId: 7, page: 1 });
    expect(listApplicantsByPosting.mock.calls[0]![0].stage).toBeUndefined();
  });

  it('미존재 공고 → 404 JOB_NOT_FOUND', async () => {
    listApplicantsByPosting.mockRejectedValue(new AppError('JOB_NOT_FOUND'));
    const res = await GET(get('999'), ctx('999'));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('JOB_NOT_FOUND');
  });
});
