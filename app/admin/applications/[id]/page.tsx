import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { isAppError } from '@/lib/errors';
import { requireOperatorPage } from '@/lib/auth/require-role-page';
import { getApplicantDetailForOperator } from '@/lib/admin/applicants';
import { resultLabel, stageLabel } from '@/lib/my-page/stage-labels';
import styles from '../applications.module.css';

// CANDID-053 Step 11 — 지원서 상세(운영자). 동결 PII snapshot **복호화 + PII_VIEW 감사**(명시 열람).
//   전형 전이/면접 등록 컨트롤은 Step 12에서 본 페이지에 추가된다(본 PR은 읽기 전용).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 감사용 IP/UA — RSC에는 NextRequest가 없어 next/headers로 best-effort 추출(없으면 null). */
async function auditContextFromHeaders(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  return {
    ipAddress: fwd === null ? null : (fwd.split(',')[0]?.trim() ?? null),
    userAgent: h.get('user-agent'),
  };
}

interface PageProps {
  params: { id: string };
}

export default async function ApplicationDetailPage({ params }: PageProps) {
  const { userId } = await requireOperatorPage(`/admin/applications/${params.id}`);
  const applicationId = Number(params.id);
  if (!Number.isInteger(applicationId) || applicationId <= 0) {
    notFound();
  }

  const { ipAddress, userAgent } = await auditContextFromHeaders();
  let detail;
  try {
    // 호출 시점에 PII 복호화 + PII_VIEW 감사가 발생(명시 열람) — 운영자 가드 통과 뒤에서만 호출.
    detail = await getApplicantDetailForOperator({ actorUserId: userId, applicationId, ipAddress, userAgent });
  } catch (err) {
    if (isAppError(err) && err.code === 'APP_NOT_FOUND') {
      notFound();
    }
    throw err;
  }

  const pii: Array<[string, string | null]> = [
    ['이름', detail.applicant.name],
    ['이메일', detail.applicant.email],
    ['연락처', detail.applicant.phone],
    ['생년월일', detail.applicant.birthDate],
    ['주소', detail.applicant.address],
  ];

  return (
    <main id="main-content" className={styles.content}>
      <header className={styles.pageHead}>
        <h1 className={styles.pageTitle}>지원서 {detail.applicationNumber}</h1>
        <Link
          href={`/admin/job-postings/${detail.jobPosting.id}/applicants`}
          className={styles.link}
        >
          ← 지원자 목록
        </Link>
      </header>

      <section className={styles.summary} aria-label="전형 요약">
        <span>
          공고: <strong>{detail.jobPosting.title}</strong>
        </span>
        <span>
          전형 단계: <strong>{stageLabel(detail.currentStage)}</strong>
        </span>
        <span>
          결과: <strong>{resultLabel(detail.result)}</strong>
        </span>
        <span>제출: {detail.submittedAt.toISOString().slice(0, 10)}</span>
        {detail.withdrawnAt !== null && (
          <span className={styles.withdrawn}>
            철회: {detail.withdrawnAt.toISOString().slice(0, 10)}
          </span>
        )}
      </section>

      <section className={styles.piiCard} aria-labelledby="pii-title">
        <h2 id="pii-title" className={styles.sectionTitle}>
          지원자 정보
        </h2>
        <p className={styles.piiNotice} role="note">
          🔒 개인정보 열람 — 본 화면 접근은 감사 로그(PII_VIEW)에 기록됩니다.
        </p>
        <dl className={styles.piiList}>
          {pii.map(([label, value]) => (
            <div key={label} className={styles.piiRow}>
              <dt>{label}</dt>
              <dd>{value ?? '—'}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="history-title">
        <h2 id="history-title" className={styles.sectionTitle}>
          전형 이력
        </h2>
        {detail.statusHistory.length === 0 ? (
          <p className={styles.empty}>이력이 없습니다.</p>
        ) : (
          <ul className={styles.history}>
            {detail.statusHistory.map((h, i) => (
              <li key={`${h.toStage}-${h.changedAt.toISOString()}-${i}`}>
                <span className={styles.histStage}>
                  {h.fromStage === null ? '제출' : stageLabel(h.fromStage)} →{' '}
                  {stageLabel(h.toStage)}
                </span>
                <time>{h.changedAt.toISOString().slice(0, 16).replace('T', ' ')}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
