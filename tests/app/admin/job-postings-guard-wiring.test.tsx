// CANDID-053 Step 9 — 공고 목록 RSC 가드 호출 회귀 가드(defense-in-depth, Step 8 계약 연장).
// 목록 페이지가 requireOperatorPage를 개별 호출하는지 고정. (생성/수정 폼 페이지는 Step 10에서 동반 가드)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/auth/require-role-page', () => ({ requireOperatorPage: vi.fn() }));
vi.mock('@/lib/admin/job-postings-list', () => ({ listJobPostingsForAdmin: vi.fn() }));
// 상태 전이 client 컴포넌트는 가드 검증 범위 밖 — 경량 모킹.
vi.mock('@/app/admin/job-postings/_components/StatusControl', () => ({
  StatusControl: () => React.createElement('span'),
}));

const { requireOperatorPage } = (await import('@/lib/auth/require-role-page')) as unknown as {
  requireOperatorPage: Mock;
};
const { listJobPostingsForAdmin } = (await import('@/lib/admin/job-postings-list')) as unknown as {
  listJobPostingsForAdmin: Mock;
};
const ListPage = (await import('@/app/admin/job-postings/page')).default;

beforeEach(() => {
  vi.clearAllMocks();
  requireOperatorPage.mockResolvedValue({ userId: 1, role: 'ADMIN' });
  listJobPostingsForAdmin.mockResolvedValue({
    items: [],
    pagination: { page: 1, perPage: 20, total: 0, totalPages: 1, hasMore: false },
  });
});
afterEach(() => cleanup());

describe('공고 목록 RSC defense-in-depth 가드', () => {
  it('목록 페이지가 requireOperatorPage를 호출한다', async () => {
    render(await ListPage({ searchParams: {} }));
    expect(requireOperatorPage).toHaveBeenCalledTimes(1);
  });

  it('가드가 흐름을 끊으면(throw) 목록 데이터를 조회하지 않는다', async () => {
    requireOperatorPage.mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
    await expect(ListPage({ searchParams: {} })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(listJobPostingsForAdmin).not.toHaveBeenCalled();
  });
});
