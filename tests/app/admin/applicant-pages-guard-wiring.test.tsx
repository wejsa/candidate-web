// CANDID-053 Step 11 — 지원자 목록/상세 RSC 가드·notFound·PII 열람 회귀 가드(defense-in-depth).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StageType, ApplicationResult } from '@prisma/client';
import React from 'react';

// 운영 대시보드 페이지 크기(SSOT). 목록 조회 인자 검증에 사용.
const OPERATOR_DASHBOARD_PER_PAGE = 50;

vi.mock('@/lib/auth/require-role-page', () => ({ requireOperatorPage: vi.fn() }));
vi.mock('@/lib/admin/applicants', () => ({
  listApplicantsByPosting: vi.fn(),
  getApplicantStatsByPosting: vi.fn(),
  getApplicantDetailForOperator: vi.fn(),
  OPERATOR_DASHBOARD_PER_PAGE: 50,
}));

// 전형 KPI 집계 — 모든 enum 키 0으로 채운 ApplicantStageStats 형태.
const zeroMap = <T extends string>(vals: readonly T[]): Record<T, number> =>
  Object.fromEntries(vals.map((v) => [v, 0])) as Record<T, number>;
const makeStats = () => ({
  total: 0,
  byStage: zeroMap(Object.values(StageType)),
  byResult: zeroMap(Object.values(ApplicationResult)),
});
// 목록 조회 결과 — page.tsx는 posting.title(헤더) + items + pagination을 사용.
const makeList = (items: unknown[], pagination: Record<string, unknown>) => ({
  posting: { id: 9, title: '백엔드' },
  items,
  pagination,
});
// 실제 headers().get()은 미존재 시 null 반환(Map은 undefined) — 제어 가능한 mock(테스트별 헤더 주입).
vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  // Step 12: 상세 페이지가 전형/면접 컨트롤(client, useRouter)을 렌더 → 스텁 제공.
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const { requireOperatorPage } = (await import('@/lib/auth/require-role-page')) as unknown as {
  requireOperatorPage: Mock;
};
const applicants = (await import('@/lib/admin/applicants')) as unknown as {
  listApplicantsByPosting: Mock;
  getApplicantStatsByPosting: Mock;
  getApplicantDetailForOperator: Mock;
};
const { headers } = (await import('next/headers')) as unknown as { headers: Mock };
const { AppError } = await import('@/lib/errors');
const ApplicantsPage = (await import('@/app/admin/job-postings/[id]/applicants/page')).default;
const DetailPage = (await import('@/app/admin/applications/[id]/page')).default;

beforeEach(() => {
  vi.clearAllMocks();
  headers.mockResolvedValue({ get: () => null }); // 기본: 헤더 없음(ip/ua null)
  requireOperatorPage.mockResolvedValue({ userId: 42, role: 'RECRUITER' });
  applicants.listApplicantsByPosting.mockResolvedValue(
    makeList([], { page: 1, perPage: OPERATOR_DASHBOARD_PER_PAGE, total: 0, totalPages: 1, hasMore: false }),
  );
  applicants.getApplicantStatsByPosting.mockResolvedValue(makeStats());
  applicants.getApplicantDetailForOperator.mockResolvedValue({
    applicationId: 5,
    applicationNumber: 'A-202607-00001',
    jobPosting: { id: 9, title: '백엔드' },
    currentStage: 'DOC_REVIEW',
    result: 'IN_PROGRESS',
    submittedAt: new Date('2026-07-01T05:00:00Z'),
    withdrawnAt: null,
    applicant: { name: '홍길동', email: 'a@b.com', phone: '010', birthDate: '1990-01-01', address: '서울' },
    statusHistory: [],
  });
});
afterEach(() => cleanup());

describe('지원자 목록 페이지', () => {
  it('requireOperatorPage 호출 + 목록 조회', async () => {
    render(await ApplicantsPage({ params: { id: '9' }, searchParams: {} }));
    expect(requireOperatorPage).toHaveBeenCalledTimes(1);
    expect(applicants.listApplicantsByPosting).toHaveBeenCalledWith({
      jobPostingId: 9,
      page: 1,
      stage: undefined,
      perPage: OPERATOR_DASHBOARD_PER_PAGE,
    });
  });

  it('유효 stage 필터 전달, 잘못된 stage는 무시', async () => {
    await ApplicantsPage({ params: { id: '9' }, searchParams: { stage: 'DOC_REVIEW' } });
    expect(applicants.listApplicantsByPosting.mock.calls[0]![0].stage).toBe('DOC_REVIEW');
    vi.clearAllMocks();
    requireOperatorPage.mockResolvedValue({ userId: 42, role: 'RECRUITER' });
    applicants.listApplicantsByPosting.mockResolvedValue(
      makeList([], { page: 1, perPage: OPERATOR_DASHBOARD_PER_PAGE, total: 0, totalPages: 1, hasMore: false }),
    );
    applicants.getApplicantStatsByPosting.mockResolvedValue(makeStats());
    await ApplicantsPage({ params: { id: '9' }, searchParams: { stage: 'BOGUS' } });
    expect(applicants.listApplicantsByPosting.mock.calls[0]![0].stage).toBeUndefined();
  });

  it('행 렌더: 마스킹 값 + 상세 링크 표시(평문 미노출 — 마스킹→평문 회귀 차단)', async () => {
    applicants.listApplicantsByPosting.mockResolvedValue(
      makeList(
        [
          {
            applicationId: 5,
            applicationNumber: 'A-202607-00001',
            currentStage: 'DOC_REVIEW',
            result: 'IN_PROGRESS',
            submittedAt: new Date('2026-07-01T05:00:00Z'),
            applicantNameMasked: '홍*동',
            applicantEmailMasked: 'a***@b.com',
          },
        ],
        { page: 2, perPage: OPERATOR_DASHBOARD_PER_PAGE, total: 45, totalPages: 3, hasMore: true },
      ),
    );
    render(await ApplicantsPage({ params: { id: '9' }, searchParams: { page: '2', stage: 'DOC_REVIEW' } }));
    expect(screen.getByText('홍*동')).toBeInTheDocument();
    expect(screen.getByText('a***@b.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '상세' })).toHaveAttribute(
      'href',
      '/admin/applications/5',
    );
    // 페이징 링크가 stage 필터를 보존하는지(필터+페이징 동시 적용 회귀 차단).
    expect(screen.getByRole('link', { name: /이전/ })).toHaveAttribute(
      'href',
      '/admin/job-postings/9/applicants?page=1&stage=DOC_REVIEW',
    );
    expect(screen.getByRole('link', { name: /다음/ })).toHaveAttribute(
      'href',
      '/admin/job-postings/9/applicants?page=3&stage=DOC_REVIEW',
    );
  });

  it('잘못된 id → notFound(조회 안 함)', async () => {
    await expect(ApplicantsPage({ params: { id: 'x' }, searchParams: {} })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(applicants.listApplicantsByPosting).not.toHaveBeenCalled();
  });

  it('JOB_NOT_FOUND → notFound', async () => {
    applicants.listApplicantsByPosting.mockRejectedValueOnce(new AppError('JOB_NOT_FOUND'));
    await expect(ApplicantsPage({ params: { id: '999' }, searchParams: {} })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
});

describe('지원서 상세 페이지', () => {
  it('가드 통과 후 PII 열람 서비스를 actorUserId로 호출(PII_VIEW 감사 경로)', async () => {
    render(await DetailPage({ params: { id: '5' } }));
    expect(requireOperatorPage).toHaveBeenCalledTimes(1);
    expect(applicants.getApplicantDetailForOperator).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 42, applicationId: 5 }),
    );
    expect(screen.getByText('홍길동')).toBeInTheDocument();
    expect(screen.getByText(/감사 로그\(PII_VIEW\)/)).toBeInTheDocument();
  });

  it('x-forwarded-for/user-agent를 감사 컨텍스트로 전달(첫 IP)', async () => {
    headers.mockResolvedValue({
      get: (n: string) =>
        n === 'x-forwarded-for' ? '1.2.3.4, 5.6.7.8' : n === 'user-agent' ? 'TestUA/1' : null,
    });
    render(await DetailPage({ params: { id: '5' } }));
    expect(applicants.getApplicantDetailForOperator).toHaveBeenCalledWith(
      expect.objectContaining({ ipAddress: '1.2.3.4', userAgent: 'TestUA/1' }),
    );
  });

  it('헤더 없음 → ipAddress/userAgent null로 전달', async () => {
    render(await DetailPage({ params: { id: '5' } }));
    expect(applicants.getApplicantDetailForOperator).toHaveBeenCalledWith(
      expect.objectContaining({ ipAddress: null, userAgent: null }),
    );
  });

  it('전형 이력(채워진) + 철회 분기 렌더', async () => {
    applicants.getApplicantDetailForOperator.mockResolvedValue({
      applicationId: 5,
      applicationNumber: 'A-202607-00001',
      jobPosting: { id: 9, title: '백엔드' },
      currentStage: 'REJECTED',
      result: 'WITHDRAWN',
      submittedAt: new Date('2026-07-01T05:00:00Z'),
      withdrawnAt: new Date('2026-07-10T00:00:00Z'),
      applicant: { name: '홍길동', email: 'a@b.com', phone: '010', birthDate: '1990-01-01', address: '서울' },
      statusHistory: [
        { fromStage: null, toStage: 'DOC_REVIEW', changedAt: new Date('2026-07-01T05:00:00Z'), changedByUserId: 1 },
        { fromStage: 'DOC_REVIEW', toStage: 'INTERVIEW_1', changedAt: new Date('2026-07-05T05:00:00Z'), changedByUserId: 1 },
      ],
    });
    render(await DetailPage({ params: { id: '5' } }));
    expect(screen.getByText(/철회:/)).toBeInTheDocument();
    expect(screen.getByText(/제출 →/)).toBeInTheDocument(); // fromStage === null 분기("제출 → …")
    expect(screen.getByText(/1차 면접/)).toBeInTheDocument();
  });

  it('잘못된 id → notFound(PII 열람 안 함 — 불필요 감사 방지)', async () => {
    await expect(DetailPage({ params: { id: '0' } })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(applicants.getApplicantDetailForOperator).not.toHaveBeenCalled();
  });

  it('APP_NOT_FOUND → notFound', async () => {
    applicants.getApplicantDetailForOperator.mockRejectedValueOnce(new AppError('APP_NOT_FOUND'));
    await expect(DetailPage({ params: { id: '999' } })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
