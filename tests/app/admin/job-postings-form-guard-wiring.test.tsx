// CANDID-053 Step 10 — 공고 생성/수정 폼 RSC 가드 호출 회귀 가드(defense-in-depth, Step 8 계약 연장).
// new/edit 페이지가 각자 requireOperatorPage를 호출하는지 고정 + 잘못된 id는 notFound(데이터 미조회).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/auth/require-role-page', () => ({ requireOperatorPage: vi.fn() }));
vi.mock('@/lib/admin/job-postings-list', () => ({
  listJobCategoryOptions: vi.fn(),
  getJobPostingForEdit: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
// 폼 client 컴포넌트는 가드 검증 범위 밖 — 경량 모킹.
vi.mock('@/app/admin/job-postings/_components/JobPostingForm', () => ({
  JobPostingForm: () => React.createElement('form'),
}));

const { requireOperatorPage } = (await import('@/lib/auth/require-role-page')) as unknown as {
  requireOperatorPage: Mock;
};
const listMod = (await import('@/lib/admin/job-postings-list')) as unknown as {
  listJobCategoryOptions: Mock;
  getJobPostingForEdit: Mock;
};
const NewPage = (await import('@/app/admin/job-postings/new/page')).default;
const EditPage = (await import('@/app/admin/job-postings/[id]/edit/page')).default;

beforeEach(() => {
  vi.clearAllMocks();
  requireOperatorPage.mockResolvedValue({ userId: 1, role: 'ADMIN' });
  listMod.listJobCategoryOptions.mockResolvedValue([{ id: 1, name: '엔지니어링' }]);
  listMod.getJobPostingForEdit.mockResolvedValue({
    id: 42,
    title: 'T',
    status: 'DRAFT',
    jobCategoryId: 1,
    employmentType: 'FULL_TIME',
    careerLevel: 'ANY',
    contentHtml: '<p>x</p>',
    opensAt: new Date('2026-07-01T05:00:00Z'),
    closesAt: null,
  });
});
afterEach(() => cleanup());

describe('공고 폼 RSC defense-in-depth 가드', () => {
  it('새 공고 페이지가 requireOperatorPage를 호출한다', async () => {
    render(await NewPage());
    expect(requireOperatorPage).toHaveBeenCalledTimes(1);
  });

  it('수정 페이지가 requireOperatorPage를 호출한다', async () => {
    render(await EditPage({ params: { id: '42' } }));
    expect(requireOperatorPage).toHaveBeenCalledTimes(1);
  });

  it('수정 페이지: 잘못된 id → notFound(데이터 조회 안 함)', async () => {
    await expect(EditPage({ params: { id: 'abc' } })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(listMod.getJobPostingForEdit).not.toHaveBeenCalled();
  });

  it('수정 페이지: 미존재 공고(JOB_NOT_FOUND) → notFound', async () => {
    const { AppError } = await import('@/lib/errors');
    listMod.getJobPostingForEdit.mockRejectedValueOnce(new AppError('JOB_NOT_FOUND'));
    await expect(EditPage({ params: { id: '999' } })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
