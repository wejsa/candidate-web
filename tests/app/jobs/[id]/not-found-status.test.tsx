// CANDID-051 Step 1 — soft-404 회귀 가드(단위).
//
// 목적: /jobs/[id] 및 /jobs/[id]/apply RSC가 "미존재/비숫자 공고"에 대해 반드시 notFound()
//       코드패스에 도달하는지 보장한다. (route export 직접 호출 정책 — tests/app/me/[applicationId]/page.test.tsx)
//
// ⚠️ 한계: 단위 테스트는 HTTP status(404 vs soft-404 200)를 검증하지 못한다 — status는 Next 런타임이
//   결정한다. 실측 결과 production에서도 notFound()가 200(soft-404)을 반환함이 확인됐다(dev 전용 아님).
//   진짜 status는 prod 서버 대상 e2e/prod/soft-404.spec.ts가 측정/가드한다.
//   본 가드는 "notFound()가 호출된다"는 코드 계약만 회귀 방지한다(status 결함과 독립).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';

// notFound()/redirect()는 throw로 흐름을 끊는 sentinel — Next 런타임 동작을 모사한다.
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

// 상세 페이지 의존 — 데이터/환경/컴포넌트는 notFound 경로에서 미실행이지만 import 부작용(prisma/jsdom/env)
// 차단을 위해 경량 모킹.
vi.mock('@/lib/jobs/detail', () => ({ getJobDetail: vi.fn() }));
vi.mock('@/lib/jobs/detail-metadata', () => ({ buildJobDetailMetadata: vi.fn() }));
vi.mock('@/lib/jobs/structured-data', () => ({
  buildJobPostingJsonLd: vi.fn(),
  jsonLdScriptContent: vi.fn(() => ''),
}));
vi.mock('@/lib/jobs/apply-cta', () => ({ resolveApplyCta: vi.fn() }));
vi.mock('@/lib/auth/server-cookies', () => ({ getOptionalAuthFromCookies: vi.fn() }));
vi.mock('@/lib/env', () => ({
  getEnv: vi.fn(() => ({ NEXT_PUBLIC_APP_URL: 'http://localhost' })),
}));
vi.mock('@/app/jobs/[id]/_components/JobDetailHeader', () => ({ JobDetailHeader: () => null }));
vi.mock('@/app/jobs/[id]/_components/JobDetailBody', () => ({ JobDetailBody: () => null }));
vi.mock('@/app/jobs/[id]/_components/ShareButton', () => ({ ShareButton: () => null }));
vi.mock('@/app/jobs/[id]/_components/ApplyCta', () => ({ ApplyCta: () => null }));

// 지원 페이지 의존.
vi.mock('@/lib/drafts/service', () => ({ getOrInitDraft: vi.fn() }));
vi.mock('@/lib/drafts/user-prefill', () => ({ loadUserPrefill: vi.fn() }));
vi.mock('@/lib/portfolios/service', () => ({ listByDraft: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  basePrisma: { jobPosting: { findUnique: vi.fn() }, resumeFile: { count: vi.fn() } },
}));
vi.mock('@/app/jobs/[id]/apply/_components/ApplicationFormShell', () => ({
  ApplicationFormShell: () => null,
}));

const navigation = (await import('next/navigation')) as unknown as {
  notFound: Mock;
  redirect: Mock;
};
const { getJobDetail } = (await import('@/lib/jobs/detail')) as unknown as { getJobDetail: Mock };
const { getOptionalAuthFromCookies } = (await import('@/lib/auth/server-cookies')) as unknown as {
  getOptionalAuthFromCookies: Mock;
};
const { getOrInitDraft } = (await import('@/lib/drafts/service')) as unknown as {
  getOrInitDraft: Mock;
};
const { loadUserPrefill } = (await import('@/lib/drafts/user-prefill')) as unknown as {
  loadUserPrefill: Mock;
};

const JobDetailPage = (await import('@/app/jobs/[id]/page')).default;
const ApplyPage = (await import('@/app/jobs/[id]/apply/page')).default;

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('CANDID-051 — /jobs/[id] notFound() 코드패스 가드', () => {
  it('비숫자 id → 서비스 조회 없이 notFound()', async () => {
    await expect(JobDetailPage({ params: { id: 'not-a-number' } })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(navigation.notFound).toHaveBeenCalledTimes(1);
    expect(getJobDetail).not.toHaveBeenCalled();
  });

  it('음수/0 id → 양의 정수 스키마 위반 → notFound()', async () => {
    await expect(JobDetailPage({ params: { id: '0' } })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(getJobDetail).not.toHaveBeenCalled();
  });

  it('미존재 공고(JOB_NOT_FOUND) → notFound()', async () => {
    getJobDetail.mockRejectedValue(new AppError('JOB_NOT_FOUND'));
    await expect(JobDetailPage({ params: { id: '999999' } })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(getJobDetail).toHaveBeenCalledWith(999999);
    expect(navigation.notFound).toHaveBeenCalledTimes(1);
  });

  it('JOB_NOT_FOUND 외 에러 → notFound()가 아닌 원본 throw (error.tsx 발화)', async () => {
    getJobDetail.mockRejectedValue(new AppError('SYS_INTERNAL_ERROR'));
    await expect(JobDetailPage({ params: { id: '5' } })).rejects.not.toThrow('NEXT_NOT_FOUND');
    expect(navigation.notFound).not.toHaveBeenCalled();
  });
});

describe('CANDID-051 — /jobs/[id]/apply notFound() 코드패스 가드', () => {
  it('비숫자 id → 인증 검사 이전에 notFound()', async () => {
    await expect(ApplyPage({ params: { id: 'bogus' } })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(getOptionalAuthFromCookies).not.toHaveBeenCalled();
  });

  it('인증 사용자 + 미존재 공고(JOB_NOT_FOUND) → notFound()', async () => {
    getOptionalAuthFromCookies.mockResolvedValue({ userId: 42 });
    loadUserPrefill.mockResolvedValue({});
    getOrInitDraft.mockRejectedValue(new AppError('JOB_NOT_FOUND'));
    await expect(ApplyPage({ params: { id: '999999' } })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(navigation.notFound).toHaveBeenCalledTimes(1);
  });

  it('인증 사용자 + 마감 공고(JOB_CLOSED) → notFound() (정보 노출 차단)', async () => {
    getOptionalAuthFromCookies.mockResolvedValue({ userId: 42 });
    loadUserPrefill.mockResolvedValue({});
    getOrInitDraft.mockRejectedValue(new AppError('JOB_CLOSED'));
    await expect(ApplyPage({ params: { id: '7' } })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(navigation.notFound).toHaveBeenCalledTimes(1);
  });

  it('비로그인 → notFound()가 아닌 /login redirect', async () => {
    getOptionalAuthFromCookies.mockResolvedValue(null);
    await expect(ApplyPage({ params: { id: '7' } })).rejects.toThrow('NEXT_REDIRECT');
    expect(navigation.redirect).toHaveBeenCalledWith(expect.stringContaining('/login?redirect='));
    expect(navigation.notFound).not.toHaveBeenCalled();
  });
});
