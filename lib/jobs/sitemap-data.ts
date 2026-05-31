// CANDID-025 Step 2 — sitemap 데이터 소스 (US-JOB SEO).
// 야간 배치가 아닌 sitemap 라우트(app/sitemap.ts)가 호출. DRAFT를 제외한 공고(OPEN/CLOSED)를
// 색인 대상으로 노출한다 — 마감 공고도 SEO 자산으로 유지(BR-JOB-02).
// list.ts(페이지네이션 조회)와 달리 id+updatedAt만 전량 조회하는 경량 쿼리.

import 'server-only';
import { unstable_cache } from 'next/cache';
import { JobStatus } from '@prisma/client';
import { basePrisma } from '@/lib/prisma';

export interface IndexableJob {
  id: number;
  updatedAt: Date;
}

const SITEMAP_CACHE_TAG = 'jobs-sitemap';
// sitemap은 자주 바뀌지 않음 — 5분 캐시로 공고 다수 시 DB 부하 흡수(R4).
const SITEMAP_CACHE_TTL_SECONDS = 300;

async function fetchIndexableJobs(): Promise<IndexableJob[]> {
  return basePrisma.jobPosting.findMany({
    where: { status: { in: [JobStatus.OPEN, JobStatus.CLOSED] } },
    select: { id: true, updatedAt: true },
    orderBy: { id: 'asc' },
  });
}

function buildCache(): () => Promise<IndexableJob[]> {
  return unstable_cache(fetchIndexableJobs, [SITEMAP_CACHE_TAG], {
    revalidate: SITEMAP_CACHE_TTL_SECONDS,
    tags: [SITEMAP_CACHE_TAG],
  });
}

let cachedFetch = buildCache();

/** 색인 가능한 공고(DRAFT 제외) 전량을 id+updatedAt만 조회 — sitemap 라우트 전용. */
export function listIndexableJobs(): Promise<IndexableJob[]> {
  return cachedFetch();
}

// L-002 — 모듈 스코프 unstable_cache 인스턴스를 재생성해 테스트 간 캐시 오염을 차단.
export function __resetSitemapCacheForTesting(): void {
  cachedFetch = buildCache();
}
