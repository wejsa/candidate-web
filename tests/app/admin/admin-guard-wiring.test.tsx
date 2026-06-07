// CANDID-053 Step 8 — 백오피스 RSC 가드 호출 회귀 가드(defense-in-depth 계약 고정).
//
// 보안 계약: Next.js 레이아웃 가드는 네비게이션 간 재실행이 비보장이므로, 각 /admin 페이지가
// 데이터/표시 직전 requireOperatorPage를 **개별 호출**해야 한다(require-role-page.ts 주석).
// 리팩토링이 "레이아웃이 이미 가드하므로 중복"이라며 페이지 가드를 제거해도 가드 함수 단위테스트는
// green이므로 보안 경계가 silent하게 붕괴한다 — 본 테스트가 호출 자체를 고정한다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/auth/require-role-page', () => ({ requireOperatorPage: vi.fn() }));
// CANDID-055: AdminLayout이 headers().get('x-pathname')로 복귀 경로를 보존 → 동기 mock 주입.
vi.mock('next/headers', () => ({ headers: () => ({ get: () => null }) }));
// AdminHomePage가 대시보드 요약을 조회 → 가드 통과 후 렌더 경로만 검증하도록 stub.
vi.mock('@/lib/admin/dashboard', () => ({ getAdminDashboardSummary: vi.fn() }));

const { requireOperatorPage } = (await import('@/lib/auth/require-role-page')) as unknown as {
  requireOperatorPage: Mock;
};
const { getAdminDashboardSummary } = (await import('@/lib/admin/dashboard')) as unknown as {
  getAdminDashboardSummary: Mock;
};
const AdminLayout = (await import('@/app/admin/layout')).default;
const AdminHomePage = (await import('@/app/admin/page')).default;

beforeEach(() => {
  vi.clearAllMocks();
  // 두 RSC 모두 운영자 컨텍스트를 받는다고 가정 — 가드 통과 경로의 렌더만 검증.
  requireOperatorPage.mockResolvedValue({ userId: 1, role: 'ADMIN' });
  getAdminDashboardSummary.mockResolvedValue({
    postings: { total: 0, byStatus: { OPEN: 0, DRAFT: 0, CLOSED: 0 } },
    applications: { total: 0, byStage: {} },
    pendingQueue: 0,
    recent: [],
  });
});
afterEach(() => cleanup());

describe('백오피스 RSC defense-in-depth 가드 호출', () => {
  it('AdminLayout은 셸 렌더 전 requireOperatorPage를 호출한다(1차 가드)', async () => {
    const ui = await AdminLayout({ children: React.createElement('div', null, 'child') });
    render(ui);
    expect(requireOperatorPage).toHaveBeenCalledTimes(1);
  });

  it('AdminHomePage는 홈 렌더 전 requireOperatorPage를 개별 호출한다(레이아웃 가드에 의존하지 않음)', async () => {
    const ui = await AdminHomePage();
    render(ui);
    expect(requireOperatorPage).toHaveBeenCalledTimes(1);
  });

  it('가드가 흐름을 끊으면(notFound/redirect throw) 페이지는 렌더되지 않는다', async () => {
    requireOperatorPage.mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
    await expect(AdminHomePage()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
