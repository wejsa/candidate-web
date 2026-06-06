// CANDID-019 Step 3 / 대시보드 재구성(A안) — 마이페이지 RSC (US-MY-001).
//
// 인증 필수 — 비로그인은 /login?redirect=/me로 redirect.
// 히어로 + 요약 통계 타일 + 3 섹션(작성중/진행중/종료) 카드 그리드.
// 빈 섹션은 EmptyState로 처리.

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApplicationResult } from '@prisma/client';
import { getOptionalAuthFromCookies } from '@/lib/auth/server-cookies';
import { getMyApplicationsList } from '@/lib/my-page/list-service';
import { ApplicationCard, DraftCard } from '@/app/me/_components/SectionCard';
import { EmptyState } from '@/app/me/_components/EmptyState';
import styles from '@/app/me/me.module.css';

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

  // 3. 요약 통계 — 진행중 / 작성중 / 합격 / 전체
  const passedCount = closed.filter((a) => a.result === ApplicationResult.PASSED).length;
  const totalCount = drafts.length + inProgress.length + closed.length;

  const stats = [
    { key: 'info', label: '진행 중', value: inProgress.length },
    { key: 'draft', label: '작성 중', value: drafts.length },
    { key: 'success', label: '합격', value: passedCount },
    { key: 'total', label: '전체', value: totalCount },
  ] as const;

  return (
    <main id="main-content" className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroRow}>
          <div>
            <h1 className={styles.heroTitle}>내 지원 현황</h1>
            <p className={styles.heroSubtitle}>
              지원한 공고와 전형 진행 상황을 한눈에 확인하세요.
            </p>
          </div>
          <Link href="/me/profile" className={styles.heroAction}>
            내 정보 수정
          </Link>
        </div>
      </header>

      <section aria-label="지원 요약">
        <ul className={styles.stats}>
          {stats.map((s) => (
            <li key={s.key} className={`${styles.statTile} ${styles[s.key]}`}>
              <span className={styles.statValue}>{s.value}</span>
              <span className={styles.statLabel}>{s.label}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="drafts-title">
        <div className={styles.sectionHead}>
          <h2 id="drafts-title" className={styles.sectionTitle}>
            작성 중인 지원서
          </h2>
          <span className={styles.sectionCount}>{drafts.length}</span>
        </div>
        {drafts.length === 0 ? (
          <EmptyState
            message="작성 중인 지원서가 없습니다."
            cta={<Link href="/jobs">채용 공고 보기</Link>}
          />
        ) : (
          <ul className={styles.cardList}>
            {drafts.map((d) => (
              <li key={d.draftId}>
                <DraftCard card={d} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="in-progress-title">
        <div className={styles.sectionHead}>
          <h2 id="in-progress-title" className={styles.sectionTitle}>
            진행 중인 지원
          </h2>
          <span className={styles.sectionCount}>{inProgress.length}</span>
        </div>
        {inProgress.length === 0 ? (
          <EmptyState message="진행 중인 지원이 없습니다." />
        ) : (
          <ul className={styles.cardList}>
            {inProgress.map((a) => (
              <li key={a.applicationId}>
                <ApplicationCard card={a} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="closed-title">
        <div className={styles.sectionHead}>
          <h2 id="closed-title" className={styles.sectionTitle}>
            종료된 지원
          </h2>
          <span className={styles.sectionCount}>{closed.length}</span>
        </div>
        {closed.length === 0 ? (
          <EmptyState message="종료된 지원이 없습니다." />
        ) : (
          <ul className={styles.cardList}>
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
