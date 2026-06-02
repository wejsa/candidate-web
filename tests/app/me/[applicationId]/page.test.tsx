// CANDID-023 Step 4 — 상세 페이지 철회 버튼 조건부 렌더 회귀 가드.
//
// result=IN_PROGRESS일 때만 WithdrawButton 노출 (이미 철회/종결 지원에 철회 버튼 미노출).
// async RSC를 직접 import해 호출 → 반환 element를 RTL로 검증 (route export 직접 테스트 정책).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/auth/server-cookies', () => ({ getOptionalAuthFromCookies: vi.fn() }));
vi.mock('@/lib/my-page/detail-service', () => ({ getMyApplicationDetail: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
vi.mock('@/app/me/_components/WithdrawButton', () => ({
  WithdrawButton: ({ applicationId }: { applicationId: number }) => (
    <div data-testid="withdraw-button">wb-{applicationId}</div>
  ),
}));
vi.mock('@/app/me/_components/SectionCard', () => ({ ApplicationCard: () => <div /> }));
vi.mock('@/app/me/_components/Timeline', () => ({ Timeline: () => <div /> }));
vi.mock('@/app/me/_components/InterviewBlock', () => ({ InterviewBlock: () => <div /> }));

const { getOptionalAuthFromCookies } = (await import('@/lib/auth/server-cookies')) as unknown as {
  getOptionalAuthFromCookies: Mock;
};
const { getMyApplicationDetail } = (await import('@/lib/my-page/detail-service')) as unknown as {
  getMyApplicationDetail: Mock;
};
const Page = (await import('@/app/me/[applicationId]/page')).default;

function detailWith(result: string) {
  return {
    summary: { jobTitle: '백엔드 엔지니어', result },
    timeline: [],
    interviews: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getOptionalAuthFromCookies.mockResolvedValue({ userId: 42 });
});
afterEach(() => cleanup());

describe('MyApplicationDetailPage — 철회 버튼 조건부 렌더', () => {
  it('result=IN_PROGRESS → 철회 버튼 노출', async () => {
    getMyApplicationDetail.mockResolvedValue(detailWith('IN_PROGRESS'));
    const el = await Page({ params: { applicationId: '100' } });
    render(el);
    expect(screen.getByTestId('withdraw-button')).toBeInTheDocument();
  });

  it('result=WITHDRAWN → 철회 버튼 미노출 (재철회 방지)', async () => {
    getMyApplicationDetail.mockResolvedValue(detailWith('WITHDRAWN'));
    const el = await Page({ params: { applicationId: '100' } });
    render(el);
    expect(screen.queryByTestId('withdraw-button')).toBeNull();
  });

  it('result=PASSED → 철회 버튼 미노출 (종결 지원)', async () => {
    getMyApplicationDetail.mockResolvedValue(detailWith('PASSED'));
    const el = await Page({ params: { applicationId: '100' } });
    render(el);
    expect(screen.queryByTestId('withdraw-button')).toBeNull();
  });
});
