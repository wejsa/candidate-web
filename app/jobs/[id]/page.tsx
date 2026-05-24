// CANDID-014 Step 2 — 공고 상세 페이지 (RSC, US-JOB-002).
// SSR(force-dynamic) — id별 가변 + sanitize cost. unstable_cache(60s)가 DB 부하 흡수.
// ApplyCta(인증/draft/이미 지원/마감 5-state)는 Step 3에서 통합.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getJobDetail } from '@/lib/jobs/detail';
import { buildJobDetailMetadata } from '@/lib/jobs/detail-metadata';
import { resolveApplyCta } from '@/lib/jobs/apply-cta';
import { getOptionalAuthFromCookies } from '@/lib/auth/server-cookies';
import { AppError } from '@/lib/errors';
import { JobDetailHeader } from '@/app/jobs/[id]/_components/JobDetailHeader';
import { JobDetailBody } from '@/app/jobs/[id]/_components/JobDetailBody';
import { ShareButton } from '@/app/jobs/[id]/_components/ShareButton';
import { ApplyCta } from '@/app/jobs/[id]/_components/ApplyCta';

const ParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

interface PageProps {
  // Next.js 15 Promise / 14 sync 모두 호환
  params: Promise<{ id: string }> | { id: string };
}

export const dynamic = 'force-dynamic';
// sanitize.ts가 jsdom 의존 — Edge 미지원. 명시.
export const runtime = 'nodejs';

async function resolveParams(raw: PageProps['params']): Promise<number | null> {
  const awaited = await raw;
  const result = ParamsSchema.safeParse(awaited);
  return result.success ? result.data.id : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const id = await resolveParams(params);
  if (id === null) {
    return { title: '채용 공고를 찾을 수 없습니다', robots: { index: false, follow: false } };
  }
  try {
    const job = await getJobDetail(id);
    return buildJobDetailMetadata(job);
  } catch (err) {
    if (err instanceof AppError && err.code === 'JOB_NOT_FOUND') {
      return { title: '채용 공고를 찾을 수 없습니다', robots: { index: false, follow: false } };
    }
    // 그 외 에러는 일단 기본 메타로 폴백 (페이지는 throw로 error.tsx 발화)
    return { title: '채용 공고' };
  }
}

export default async function JobDetailPage({ params }: PageProps) {
  const id = await resolveParams(params);
  if (id === null) notFound();
  let job;
  try {
    job = await getJobDetail(id);
  } catch (err) {
    if (err instanceof AppError && err.code === 'JOB_NOT_FOUND') notFound();
    throw err;
  }

  // CTA 분기 — 비로그인은 DB 조회 회피, 로그인은 application/draft 1쌍 병렬.
  const auth = await getOptionalAuthFromCookies();
  const cta = await resolveApplyCta({
    userId: auth?.userId ?? null,
    job: { id: job.id, isClosed: job.isClosed },
  });

  return (
    <main>
      <JobDetailHeader job={job} />
      <JobDetailBody job={job} />
      <section aria-label="지원하기">
        <ApplyCta jobId={job.id} state={cta.state} applicationNumber={cta.applicationNumber} />
      </section>
      <section aria-label="공유">
        <ShareButton title={job.title} />
      </section>
    </main>
  );
}
