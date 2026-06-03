// CANDID-019 Step 3 — 마이페이지 리스트 RSC (US-MY-001).
//
// 인증 필수 — 비로그인은 /login?redirect=/me로 redirect.
// 3 섹션(작성중/진행중/종료) 분리, 빈 섹션은 EmptyState로 처리.

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOptionalAuthFromCookies } from '@/lib/auth/server-cookies';
import { getMyApplicationsList } from '@/lib/my-page/list-service';
import { ApplicationCard, DraftCard } from '@/app/me/_components/SectionCard';
import { EmptyState } from '@/app/me/_components/EmptyState';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '마이페이지',
  description: '내가 지원한 공고와 전형 진행 상황을 확인합니다.',
  robots: { index: false, follow: false }, // 인증 페이지 — 색인 제외
};

export default async function MyPage() {
  // 1. 인증 필수
  const auth = await getOptionalAuthFromCookies();
  if (auth === null) {
    redirect(`/login?redirect=${encodeURIComponent('/me')}`);
  }

  // 2. 리스트 조회 (3 섹션 서버 분리)
  const { drafts, inProgress, closed } = await getMyApplicationsList(auth.userId);

  return (
    <main id="main-content">
      <h1>마이페이지</h1>

      <section aria-labelledby="drafts-title">
        <h2 id="drafts-title">작성 중인 지원서</h2>
        {drafts.length === 0 ? (
          <EmptyState
            message="작성 중인 지원서가 없습니다."
            cta={<Link href="/jobs">채용 공고 보기</Link>}
          />
        ) : (
          <ul>
            {drafts.map((d) => (
              <li key={d.draftId}>
                <DraftCard card={d} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="in-progress-title">
        <h2 id="in-progress-title">진행 중인 지원</h2>
        {inProgress.length === 0 ? (
          <EmptyState message="진행 중인 지원이 없습니다." />
        ) : (
          <ul>
            {inProgress.map((a) => (
              <li key={a.applicationId}>
                <ApplicationCard card={a} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="closed-title">
        <h2 id="closed-title">종료된 지원</h2>
        {closed.length === 0 ? (
          <EmptyState message="종료된 지원이 없습니다." />
        ) : (
          <ul>
            {closed.map((a) => (
              <li key={a.applicationId}>
                <ApplicationCard card={a} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
