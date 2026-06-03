// CANDID-019 Step 3 — 마이페이지 상세 RSC (US-MY-002).
//
// 인증 필수 + ownership 강제 (lib service에서 처리).
// APP_DRAFT_NOT_FOUND → notFound() — 정보 누출 회피.

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { getOptionalAuthFromCookies } from '@/lib/auth/server-cookies';
import { ApplicationResult } from '@prisma/client';
import { getMyApplicationDetail } from '@/lib/my-page/detail-service';
import { AppError } from '@/lib/errors';
import { ApplicationCard } from '@/app/me/_components/SectionCard';
import { Timeline } from '@/app/me/_components/Timeline';
import { InterviewBlock } from '@/app/me/_components/InterviewBlock';
import { WithdrawButton } from '@/app/me/_components/WithdrawButton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({
  applicationId: z.coerce.number().int().positive(),
});

interface PageProps {
  params: Promise<{ applicationId: string }> | { applicationId: string };
}

export const metadata: Metadata = {
  title: '지원 상세',
  description: '지원 건의 전형 진행 상황과 면접 일정을 확인합니다.',
  robots: { index: false, follow: false },
};

async function resolveApplicationId(raw: PageProps['params']): Promise<number | null> {
  const awaited = await raw;
  const result = ParamsSchema.safeParse(awaited);
  return result.success ? result.data.applicationId : null;
}

export default async function MyApplicationDetailPage({ params }: PageProps) {
  const applicationId = await resolveApplicationId(params);
  if (applicationId === null) notFound();

  const auth = await getOptionalAuthFromCookies();
  if (auth === null) {
    redirect(`/login?redirect=${encodeURIComponent(`/me/${applicationId}`)}`);
  }

  let detail;
  try {
    detail = await getMyApplicationDetail(auth.userId, applicationId);
  } catch (err) {
    if (err instanceof AppError && err.code === 'APP_DRAFT_NOT_FOUND') {
      notFound();
    }
    throw err;
  }

  // 단계/결과 라벨은 lib service에서 한국어 매핑되어 옴.

  return (
    <main id="main-content">
      <h1>지원 상세 — {detail.summary.jobTitle}</h1>

      <section aria-labelledby="summary-title">
        {/* h1 다음 h2로 진입 — heading hierarchy 회귀 가드 (review fix loop 1, A11y MAJOR) */}
        <h2 id="summary-title">지원 정보</h2>
        <ApplicationCard card={detail.summary} />
      </section>

      <section aria-labelledby="timeline-title">
        <h2 id="timeline-title">전형 진행 타임라인</h2>
        <Timeline entries={detail.timeline} />
      </section>

      <section aria-labelledby="interviews-title">
        <h2 id="interviews-title">면접 일정</h2>
        <InterviewBlock interviews={detail.interviews} />
      </section>

      {/* US-MY-003: 진행 중(IN_PROGRESS)인 지원만 본인이 철회 가능. */}
      {detail.summary.result === ApplicationResult.IN_PROGRESS && (
        <section aria-labelledby="withdraw-title">
          <h2 id="withdraw-title">지원 철회</h2>
          <WithdrawButton applicationId={applicationId} />
        </section>
      )}
    </main>
  );
}
