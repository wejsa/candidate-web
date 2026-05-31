import type { MetadataRoute } from 'next';
import { listIndexableJobs } from '@/lib/jobs/sitemap-data';

// CANDID-025 Step 2 — 동적 sitemap.xml. 공고(DB) 의존 → Node 런타임 + force-dynamic.
// force-dynamic: DB(DATABASE_URL) 의존이라 빌드 시 정적 프리렌더 불가 — 요청 시점 생성(상세 페이지와 동일).
// 빌드/정적 수집 단계 평가 가능성 때문에 getEnv()(전체 검증) 대신 빌드-인라인 공개변수
// NEXT_PUBLIC_APP_URL을 직접 사용한다(env.ts 기본값과 동일).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const jobs = await listIndexableJobs();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${baseUrl}/jobs`, changeFrequency: 'hourly', priority: 0.9 },
  ];
  const jobRoutes: MetadataRoute.Sitemap = jobs.map((job) => ({
    url: `${baseUrl}/jobs/${job.id}`,
    lastModified: job.updatedAt,
    changeFrequency: 'daily',
    priority: 0.8,
  }));
  return [...staticRoutes, ...jobRoutes];
}
