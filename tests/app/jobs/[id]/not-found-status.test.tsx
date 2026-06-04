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
const { resolveApplyCta } = (await import('@/lib/jobs/apply-cta')) as unknown as {
  resolveApplyCta: Mock;
};
const { buildJobDetailMetadata } = (await import('@/lib/jobs/detail-metadata')) as unknown as {
  buildJobDetailMetadata: Mock;
};

const detailMod = await import('@/app/jobs/[id]/page');
const JobDetailPage = detailMod.default;
const generateMetadata = detailMod.generateMetadata;
const applyMod = await import('@/app/jobs/[id]/apply/page');
const ApplyPage = applyMod.default;

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
    // 원본 에러가 *그대로* 재전파돼야 한다(notFound로 삼키면 5xx가 404로 마스킹). 코드까지 단언.
    await expect(JobDetailPage({ params: { id: '5' } })).rejects.toMatchObject({
      code: 'SYS_INTERNAL_ERROR',
    });
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

  it('인증 사용자 + JOB_NOT_FOUND/CLOSED 외 에러 → notFound()가 아닌 원본 throw (5xx 마스킹 방지)', async () => {
    // page.tsx:56 — JOB_NOT_FOUND/JOB_CLOSED만 notFound()로 흡수, 그 외는 재전파(error.tsx → 500).
    // detail과 동일 비대칭 회귀 가드(SYS 에러가 404로 은폐되면 장애 추적 불가).
    getOptionalAuthFromCookies.mockResolvedValue({ userId: 42 });
    loadUserPrefill.mockResolvedValue({});
    getOrInitDraft.mockRejectedValue(new AppError('SYS_INTERNAL_ERROR'));
    // 원본 SYS 에러 코드가 그대로 재전파됨을 직접 단언(resolve/다른에러로 회귀해도 잡히도록).
    await expect(ApplyPage({ params: { id: '7' } })).rejects.toMatchObject({
      code: 'SYS_INTERNAL_ERROR',
    });
    expect(navigation.notFound).not.toHaveBeenCalled();
  });
});

// CANDID-051: soft-404의 *유일한* SEO 방어선은 robots:noindex다(notFound() status는 Next 14 한계로 200).
// noindex 분기가 회귀하면 죽은 URL이 색인되므로 메타데이터 레벨에서 고정한다.
describe('CANDID-051 — robots:noindex 미티게이션 가드 (SEO 방어선)', () => {
  it('상세 generateMetadata: 비숫자 id → robots noindex (서비스 조회 없이)', async () => {
    const meta = await generateMetadata({ params: { id: 'not-a-number' } });
    expect(meta.robots).toMatchObject({ index: false, follow: false });
    expect(getJobDetail).not.toHaveBeenCalled();
  });

  it('상세 generateMetadata: JOB_NOT_FOUND → robots noindex', async () => {
    getJobDetail.mockRejectedValue(new AppError('JOB_NOT_FOUND'));
    const meta = await generateMetadata({ params: { id: '999999' } });
    expect(meta.robots).toMatchObject({ index: false, follow: false });
  });

  it('상세 generateMetadata: 존재 공고 → 색인 허용(buildJobDetailMetadata 위임, noindex 아님)', async () => {
    // 정상 공고는 색인돼야 한다 — noindex가 과도 적용되지 않음을 고정(과잉수정 방지).
    getJobDetail.mockResolvedValue({ id: 7, isClosed: false, title: '백엔드 엔지니어' });
    buildJobDetailMetadata.mockReturnValue({ title: '백엔드 엔지니어' }); // robots 미설정 = 색인 허용
    const meta = await generateMetadata({ params: { id: '7' } });
    // not-found 분기의 강제 noindex와 구분됨(과잉수정 방지).
    expect(meta.robots).toBeUndefined();
  });

  it('상세 generateMetadata: JOB_NOT_FOUND 외 에러 → noindex 아닌 기본 메타 폴백', async () => {
    // page.tsx 폴백 분기: not-found가 아닌 일반 에러는 noindex를 *강제하지 않고* 기본 메타로 떨어진다
    // (페이지 본문은 throw → error.tsx). noindex가 이 경로로 새지 않음을 음성 가드로 고정.
    getJobDetail.mockRejectedValue(new AppError('SYS_INTERNAL_ERROR'));
    const meta = await generateMetadata({ params: { id: '5' } });
    expect(meta.robots).toBeUndefined();
    expect(meta.title).toBe('채용 공고');
  });

  it('지원 페이지 정적 metadata: 항상 robots noindex (인증 게이트 폼 — 비색인)', () => {
    expect(applyMod.metadata?.robots).toMatchObject({ index: false, follow: false });
  });
});

// CANDID-051: 마감 공고(JOB_CLOSED)는 상세에서 notFound()가 아니라 정상 렌더돼야 한다(BR-JOB-02 SEO 자산).
// apply(차단) vs detail(노출)의 의도된 비대칭을 고정 — "상세도 마감 시 notFound" 오해로 인한 회귀 방지.
describe('CANDID-051 — 마감 공고 상세 노출 정책 (apply 차단과 비대칭)', () => {
  it('상세: JOB_CLOSED 공고 → notFound() 아닌 정상 렌더', async () => {
    getJobDetail.mockResolvedValue({ id: 7, isClosed: true, title: '마감된 공고' });
    getOptionalAuthFromCookies.mockResolvedValue(null);
    resolveApplyCta.mockResolvedValue({ state: 'CLOSED', applicationNumber: null });
    await expect(JobDetailPage({ params: { id: '7' } })).resolves.toBeDefined();
    expect(navigation.notFound).not.toHaveBeenCalled();
  });
});
