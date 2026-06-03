// CANDID-015 Step 3 — 지원서 작성 페이지 RSC (US-APP-001).
// 인증 필수 — 비로그인 시 /login?redirect=/jobs/{id}/apply로 redirect.
// 공고 게이트 + Draft 진입 + User PII prefill을 RSC에서 처리.

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
