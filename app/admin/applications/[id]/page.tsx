import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { isAppError } from '@/lib/errors';
import { requireOperatorPage } from '@/lib/auth/require-role-page';
import { getApplicantDetailForOperator } from '@/lib/admin/applicants';
import { resultLabel, stageLabel } from '@/lib/my-page/stage-labels';
import { StageTransitionControl } from '@/app/admin/applications/_components/StageTransitionControl';
import { InterviewScheduleForm } from '@/app/admin/applications/_components/InterviewScheduleForm';
import { ResumeDownloadButton } from '@/app/admin/applications/_components/ResumeDownloadButton';
import type { PortfolioLinkType, VirusScanStatus } from '@prisma/client';
import styles from '../applications.module.css';

// CANDID-066 — 첨부/포트폴리오 표시 라벨 + 파일 크기 포맷.
const SCAN_LABEL: Record<VirusScanStatus, string> = {
  PENDING: '스캔 대기',
  CLEAN: '스캔 완료',
  INFECTED: '감염 확인',
  FAILED: '스캔 실패',
};
const PORTFOLIO_LABEL: Record<PortfolioLinkType, string> = {
  GITHUB: 'GitHub',
  NOTION: 'Notion',
  BLOG: '블로그',
  LINKEDIN: 'LinkedIn',
  FIGMA: 'Figma',
  ETC: '기타',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// CANDID-053 Step 11/12 — 지원서 상세(운영자). 동결 PII snapshot **복호화 + PII_VIEW 감사**(명시 열람).
//   Step 12: 전형 전이/면접 등록 컨트롤(쓰기) 추가. 철회 지원서는 컨트롤 비노출.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 감사용 IP/UA — RSC에는 NextRequest가 없어 next/headers로 best-effort 추출(없으면 null).
 *  ⚠️ x-forwarded-for 첫 값은 클라이언트가 주입 가능(스푸핑) — 감사 IP는 참고용. 신뢰 IP가 필요하면
 *  인프라(LB/프록시)가 세팅하는 신뢰 헤더를 별도 도입한다(향후 강화). */
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

      {/* CANDID-066 — 첨부 이력서 (메타 + 보안 다운로드). 실제 파일은 presigned 다운로드(감사·게이팅). */}
      <section aria-labelledby="resume-title" className={styles.piiCard}>
        <h2 id="resume-title" className={styles.sectionTitle}>
          첨부 이력서
        </h2>
        {detail.resumeFile == null ? (
          <p className={styles.empty}>첨부된 이력서가 없습니다.</p>
        ) : (
          <div className={styles.fileRow}>
            <div className={styles.fileMeta}>
              <span className={styles.fileName}>{detail.resumeFile.originalFilename}</span>
              <span className={styles.fileSub}>
                {formatBytes(detail.resumeFile.fileSize)} · {SCAN_LABEL[detail.resumeFile.virusScanStatus]}
                {' · 업로드 '}
                {detail.resumeFile.uploadedAt.toISOString().slice(0, 10)}
              </span>
              {detail.resumeFile.virusScanStatus !== 'CLEAN' &&
                detail.resumeFile.virusScanStatus !== 'INFECTED' && (
                  <span className={styles.scanWarn} role="note">
                    ⚠️ 바이러스 스캔이 완료되지 않았습니다. 열람 시 주의하세요.
                  </span>
                )}
            </div>
            <ResumeDownloadButton
              applicationId={detail.applicationId}
              virusScanStatus={detail.resumeFile.virusScanStatus}
            />
          </div>
        )}
      </section>

      {/* CANDID-066 — 포트폴리오 링크(표시 전용). 외부 링크는 noopener/noreferrer + 새 탭. */}
      <section aria-labelledby="portfolio-title">
        <h2 id="portfolio-title" className={styles.sectionTitle}>
          포트폴리오 링크
        </h2>
        {detail.portfolioLinks.length === 0 ? (
          <p className={styles.empty}>등록된 포트폴리오 링크가 없습니다.</p>
        ) : (
          <ul className={styles.portfolioList}>
            {detail.portfolioLinks.map((l) => (
              <li key={l.id} className={styles.portfolioItem}>
                <span className={styles.linkType}>{PORTFOLIO_LABEL[l.linkType]}</span>
                <a href={l.url} target="_blank" rel="noopener noreferrer" className={styles.link}>
                  {l.url}
                </a>
                {l.memo !== null && l.memo !== '' && <span className={styles.linkMemo}>{l.memo}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className={styles.hint}>외부 비공개 페이지는 접근이 제한될 수 있습니다.</p>
      </section>

      {/* 전형 관리(쓰기) — 철회 지원서는 전이/면접 컨트롤 비노출(서버도 거부). 종단 단계는 컨트롤이 안내. */}
      {detail.result === 'WITHDRAWN' ? (
        <section aria-label="전형 관리">
          <h2 className={styles.sectionTitle}>전형 관리</h2>
          <p className={styles.empty}>철회된 지원서는 전형/면접을 변경할 수 없습니다.</p>
        </section>
      ) : (
        <>
          <section aria-labelledby="stage-title">
            <h2 id="stage-title" className={styles.sectionTitle}>
              전형 단계 변경
            </h2>
            <StageTransitionControl
              applicationId={detail.applicationId}
              currentStage={detail.currentStage}
            />
          </section>

          <section aria-labelledby="interview-title" className={styles.piiCard}>
            <h2 id="interview-title" className={styles.sectionTitle}>
              면접 일정 등록
            </h2>
            {/* 종단(최종 합격/불합격) 지원자는 면접 일정 등록 불필요 → 폼 비활성화. */}
            <InterviewScheduleForm
              applicationId={detail.applicationId}
              disabled={detail.result === 'PASSED' || detail.result === 'FAILED'}
              disabledReason={
                detail.result === 'PASSED' || detail.result === 'FAILED'
                  ? `${resultLabel(detail.result)} 처리된 지원자는 면접 일정을 등록할 필요가 없습니다.`
                  : null
              }
            />
          </section>
        </>
      )}
    </main>
  );
}
