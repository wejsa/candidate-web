// CANDID-015 Step 3 — 지원서 작성 페이지 RSC (US-APP-001).
// 인증 필수 — 비로그인 시 /login?redirect=/jobs/{id}/apply로 redirect.
// 공고 게이트 + Draft 진입 + User PII prefill을 RSC에서 처리.

import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { z } from 'zod';
import { getOptionalAuthFromCookies } from '@/lib/auth/server-cookies';
import { getOrInitDraft } from '@/lib/drafts/service';
import { loadUserPrefill } from '@/lib/drafts/user-prefill';
import { listByDraft } from '@/lib/portfolios/service';
import { basePrisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import type { DraftPayloadV1 } from '@/lib/drafts/types';
import { ApplicationFormShell } from '@/app/jobs/[id]/apply/_components/ApplicationFormShell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// CANDID-051: 지원서 작성 페이지는 인증 게이트 뒤의 개인화 폼 — 검색 색인 대상이 아니다.
// 더해, 미존재/마감 공고 진입 시 notFound()가 Next 14 SSR에서 HTTP 200(soft-404)을 반환하는
// 프레임워크 한계가 있어(상세는 docs/requirements/CANDID-051-spec.md), 색인 차단을 status에 의존하지 않고
// 정적 메타데이터로 *항상* noindex를 보장한다. 이로써 soft-404 경로의 죽은 URL 색인 위험을 제거한다.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const ParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

interface PageProps {
  params: Promise<{ id: string }> | { id: string };
}

async function resolveJobId(raw: PageProps['params']): Promise<number | null> {
  const awaited = await raw;
  const result = ParamsSchema.safeParse(awaited);
  return result.success ? result.data.id : null;
}

export default async function ApplyPage({ params }: PageProps) {
  const jobId = await resolveJobId(params);
  if (jobId === null) notFound();

  // 1. 인증 필수 — 비로그인은 로그인 페이지로 (redirect URL 보존)
  const auth = await getOptionalAuthFromCookies();
  if (auth === null) {
    redirect(`/login?redirect=${encodeURIComponent(`/jobs/${jobId}/apply`)}`);
  }

  // 2. User PII prefill 선검증 + Draft 진입 (route와 동일 순차 호출)
  const prefill = await loadUserPrefill(auth.userId);
  let draft;
  try {
    const result = await getOrInitDraft(auth.userId, jobId);
    draft = result.draft;
  } catch (err) {
    if (err instanceof AppError) {
      // JOB_NOT_FOUND (미존재/DRAFT) / JOB_CLOSED 모두 not-found로 통합 (정보 노출 차단)
      if (err.code === 'JOB_NOT_FOUND' || err.code === 'JOB_CLOSED') {
        notFound();
      }
    }
    throw err;
  }

  // 3. 단일 페이지 재구성에 필요한 부가 데이터: 공고명 + 이력서 첨부 여부 + 포트폴리오 링크.
  const [job, resumeCount, portfolioLinks] = await Promise.all([
    basePrisma.jobPosting.findUnique({ where: { id: jobId }, select: { title: true } }),
    basePrisma.resumeFile.count({ where: { draftId: draft.id } }),
    listByDraft({ userId: auth.userId, jobPostingId: jobId }),
  ]);

  return (
    <main id="main-content">
      <ApplicationFormShell
        jobId={jobId}
        jobTitle={job?.title ?? '채용 공고'}
        draftDbId={draft.id}
        initialPayload={draft.payloadJson as unknown as DraftPayloadV1}
        initialVersion={draft.version}
        prefill={prefill}
        initialResumeAttached={resumeCount > 0}
        initialPortfolioLinks={portfolioLinks.map((l) => ({
          linkType: l.linkType,
          url: l.url,
          memo: l.memo,
        }))}
      />
    </main>
  );
}
