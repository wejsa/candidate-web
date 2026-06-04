// CANDID-053 Step 4 — POST /api/admin/v1/job-postings 라우터 테스트.
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';

vi.mock('@/lib/auth/require-role', () => ({ requireRole: vi.fn() }));
vi.mock('@/lib/admin/job-postings', () => ({ createJobPosting: vi.fn() }));

const { requireRole } = (await import('@/lib/auth/require-role')) as unknown as { requireRole: Mock };
const { createJobPosting } = (await import('@/lib/admin/job-postings')) as unknown as {
  createJobPosting: Mock;
};
const { POST } = await import('@/app/api/admin/v1/job-postings/route');

const VALID = {
  title: 'BE',
  jobCategoryId: 1,
  employmentType: 'FULL_TIME',
  careerLevel: 'ANY',
  contentHtml: '<p>hi</p>',
  opensAt: '2026-07-01T00:00:00.000Z',
};
function post(body: unknown): NextRequest {
  return new NextRequest('https://candidate.example.com/api/admin/v1/job-postings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  requireRole.mockResolvedValue({ userId: 1, role: 'RECRUITER' });
});

describe('POST /api/admin/v1/job-postings', () => {
  it('RECRUITER 생성 → 201', async () => {
    createJobPosting.mockResolvedValue({ id: 10, title: 'BE', status: 'DRAFT' });
    const res = await POST(post(VALID), undefined);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: 10, status: 'DRAFT' });
    expect(requireRole).toHaveBeenCalledWith(expect.anything(), 'RECRUITER', 'ADMIN');
  });

  it('필수 필드 누락 → 400', async () => {
    const { title, ...rest } = VALID;
    void title;
    const res = await POST(post(rest), undefined);
    expect(res.status).toBe(400);
    expect(createJobPosting).not.toHaveBeenCalled();
  });

  it('권한 부족 → 403 (requireRole 전파)', async () => {
    requireRole.mockRejectedValue(new AppError('AUTH_FORBIDDEN'));
    const res = await POST(post(VALID), undefined);
    expect(res.status).toBe(403);
    expect(createJobPosting).not.toHaveBeenCalled();
  });
});
