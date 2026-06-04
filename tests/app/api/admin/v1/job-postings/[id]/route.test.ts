// CANDID-053 Step 4 — PATCH /api/admin/v1/job-postings/[id] 라우터 테스트.
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';

vi.mock('@/lib/auth/require-role', () => ({ requireRole: vi.fn() }));
vi.mock('@/lib/admin/job-postings', () => ({ updateJobPosting: vi.fn() }));

const { requireRole } = (await import('@/lib/auth/require-role')) as unknown as { requireRole: Mock };
const { updateJobPosting } = (await import('@/lib/admin/job-postings')) as unknown as {
  updateJobPosting: Mock;
};
const { PATCH } = await import('@/app/api/admin/v1/job-postings/[id]/route');

function patch(id: string, body: unknown): NextRequest {
  return new NextRequest(`https://candidate.example.com/api/admin/v1/job-postings/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const ctx = (id: string) => ({ params: { id } });

beforeEach(() => {
  vi.resetAllMocks();
  requireRole.mockResolvedValue({ userId: 1, role: 'RECRUITER' });
});

describe('PATCH /api/admin/v1/job-postings/[id]', () => {
  it('상태 전이(OPEN) → 200', async () => {
    updateJobPosting.mockResolvedValue({ id: 10, title: 'BE', status: 'OPEN' });
    const res = await PATCH(patch('10', { status: 'OPEN' }), ctx('10'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'OPEN' });
  });

  it('빈 body → 400 (수정 항목 없음)', async () => {
    const res = await PATCH(patch('10', {}), ctx('10'));
    expect(res.status).toBe(400);
    expect(updateJobPosting).not.toHaveBeenCalled();
  });

  it('잘못된 전이 → 409 JOB_INVALID_STATUS_TRANSITION (도메인 에러 변환)', async () => {
    updateJobPosting.mockRejectedValue(new AppError('JOB_INVALID_STATUS_TRANSITION'));
    const res = await PATCH(patch('10', { status: 'OPEN' }), ctx('10'));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('JOB_INVALID_STATUS_TRANSITION');
  });

  it('권한 부족 → 403', async () => {
    requireRole.mockRejectedValue(new AppError('AUTH_FORBIDDEN'));
    const res = await PATCH(patch('10', { status: 'OPEN' }), ctx('10'));
    expect(res.status).toBe(403);
  });
});
