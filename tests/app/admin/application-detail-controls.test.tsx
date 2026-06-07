// CANDID-053 Step 12 — 상세 페이지의 전형/면접 컨트롤 조건부 렌더(철회=비노출) 회귀 가드.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/auth/require-role-page', () => ({ requireOperatorPage: vi.fn() }));
vi.mock('@/lib/admin/applicants', () => ({ getApplicantDetailForOperator: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => ({ get: () => null })) }));
vi.mock('next/navigation', () => ({ notFound: vi.fn(() => { throw new Error('NF'); }) }));
// 컨트롤은 스텁 — 조건부 렌더 여부만 검증(상호작용은 각 컴포넌트 테스트가 담당).
vi.mock('@/app/admin/applications/_components/StageTransitionControl', () => ({
  StageTransitionControl: () => React.createElement('div', { 'data-testid': 'stage-ctrl' }),
}));
vi.mock('@/app/admin/applications/_components/InterviewScheduleForm', () => ({
  InterviewScheduleForm: () => React.createElement('div', { 'data-testid': 'interview-form' }),
}));

const { requireOperatorPage } = (await import('@/lib/auth/require-role-page')) as unknown as {
  requireOperatorPage: Mock;
};
const { getApplicantDetailForOperator } = (await import('@/lib/admin/applicants')) as unknown as {
  getApplicantDetailForOperator: Mock;
};
const DetailPage = (await import('@/app/admin/applications/[id]/page')).default;

function detail(over: Record<string, unknown> = {}) {
  return {
    applicationId: 5,
    applicationNumber: 'A-202607-00001',
    jobPosting: { id: 9, title: '백엔드' },
    currentStage: 'DOC_REVIEW',
    result: 'IN_PROGRESS',
    submittedAt: new Date('2026-07-01T05:00:00Z'),
    withdrawnAt: null,
    applicant: { name: '홍', email: 'a@b.com', phone: '010', birthDate: '1990', address: '서울' },
    statusHistory: [],
    resumeFile: null,
    portfolioLinks: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOperatorPage.mockResolvedValue({ userId: 42, role: 'RECRUITER' });
});
afterEach(() => cleanup());

describe('상세 전형/면접 컨트롤 조건부 렌더', () => {
  it('진행 중(IN_PROGRESS) → 전형 전이 + 면접 폼 노출', async () => {
    getApplicantDetailForOperator.mockResolvedValue(detail());
    render(await DetailPage({ params: { id: '5' } }));
    expect(screen.getByTestId('stage-ctrl')).toBeInTheDocument();
    expect(screen.getByTestId('interview-form')).toBeInTheDocument();
  });

  it('철회(WITHDRAWN) → 컨트롤 비노출 + 변경 불가 안내', async () => {
    getApplicantDetailForOperator.mockResolvedValue(
      detail({ result: 'WITHDRAWN', withdrawnAt: new Date('2026-07-10T00:00:00Z') }),
    );
    render(await DetailPage({ params: { id: '5' } }));
    expect(screen.queryByTestId('stage-ctrl')).toBeNull();
    expect(screen.queryByTestId('interview-form')).toBeNull();
    expect(screen.getByText(/변경할 수 없습니다/)).toBeInTheDocument();
  });
});
