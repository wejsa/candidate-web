import Link from 'next/link';
import type { JobStatus } from '@prisma/client';
import { requireOperatorPage } from '@/lib/auth/require-role-page';
import { getAdminDashboardSummary } from '@/lib/admin/dashboard';
import { stageLabel } from '@/lib/my-page/stage-labels';
import styles from './admin.module.css';

// CANDID-053 Step 8 / CANDID-054 FR-003 — 백오피스 대시보드 홈. 전사 요약 위젯 + 작업 진입 카드.
//   레이아웃이 셸 가드를 수행하지만, 페이지도 데이터/표시 직전 가드를 재호출(defense-in-depth).
//   요약은 카운트/마스킹 식별 단서만(평문 PII 미접촉).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<JobStatus, string> = {
  DRAFT: '임시저장',
  OPEN: '공개',
  CLOSED: '마감',
};

const ENTRY_CARDS = [
  {
    href: '/admin/job-postings',
    title: '공고 관리',
    desc: '채용 공고를 생성·수정하고 모집 상태를 전환합니다.',
  },
] as const;

const dateFmt = new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' });

export default async function AdminHomePage() {
  const { role } = await requireOperatorPage();
  const summary = await getAdminDashboardSummary();

  return (
    <main id="main-content" className={styles.content}>
      <header className={styles.pageHead}>
        <h1 className={styles.pageTitle}>운영 대시보드</h1>
        <p className={styles.pageSubtitle}>
          {role} 권한으로 로그인했습니다. 채용 현황을 한눈에 확인하세요.
        </p>
      </header>

      {/* ── 핵심 지표 ─────────────────────────────────────── */}
      <section className={styles.statGrid} aria-label="채용 현황 요약">
        <div className={styles.statCard}>
          <span className={styles.statValue}>{summary.postings.total}</span>
          <span className={styles.statLabel}>전체 공고</span>
          <span className={styles.statSub}>
            공개 {summary.postings.byStatus.OPEN} · 임시 {summary.postings.byStatus.DRAFT} · 마감{' '}
            {summary.postings.byStatus.CLOSED}
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{summary.applications.total}</span>
          <span className={styles.statLabel}>전체 지원</span>
        </div>
        <div className={`${styles.statCard} ${styles.statAccent}`}>
          <span className={styles.statValue}>{summary.pendingQueue}</span>
          <span className={styles.statLabel}>미처리 큐</span>
          <span className={styles.statSub}>제출 + 서류 검토 대기</span>
        </div>
      </section>

      {/* ── 공고 상태 분포 + 최근 지원 ──────────────────────── */}
      <section className={styles.panelRow}>
        <div className={styles.panel} aria-label="공고 상태 분포">
          <h2 className={styles.panelTitle}>공고 상태</h2>
          <ul className={styles.statusList}>
            {(Object.keys(STATUS_LABEL) as JobStatus[]).map((s) => (
              <li key={s} className={styles.statusItem}>
                <span>{STATUS_LABEL[s]}</span>
                <span className={styles.statusCount}>{summary.postings.byStatus[s]}</span>
              </li>
            ))}
          </ul>
          <Link href="/admin/job-postings" className={styles.panelLink}>
            공고 관리 →
          </Link>
        </div>

        <div className={styles.panel} aria-label="최근 지원">
          <h2 className={styles.panelTitle}>최근 지원</h2>
          {summary.recent.length === 0 ? (
            <p className={styles.entryDesc}>아직 지원 내역이 없습니다.</p>
          ) : (
            <ul className={styles.recentList}>
              {summary.recent.map((r) => (
                <li key={r.applicationId} className={styles.recentItem}>
                  <Link href={`/admin/applications/${r.applicationId}`} className={styles.recentMain}>
                    <span className={styles.recentName}>{r.applicantNameMasked ?? '—'}</span>
                    <span className={styles.recentJob}>{r.jobTitle}</span>
                  </Link>
                  <span className={styles.recentMeta}>
                    {stageLabel(r.currentStage)} · {dateFmt.format(r.submittedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── 작업 진입 카드 ───────────────────────────────── */}
      <ul className={styles.cardGrid}>
        {ENTRY_CARDS.map((card) => (
          <li key={card.href}>
            <Link href={card.href} className={styles.entryCard}>
              <span className={styles.entryTitle}>{card.title}</span>
              <span className={styles.entryDesc}>{card.desc}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
