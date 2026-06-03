// CANDID-019 Step 3 / 대시보드 재구성(A안) — 지원 내역 카드.
// 진행중/종료 카드는 상태 배지 + 전형 진행바(StageProgress) + stretched-link.
// 작성중(Draft) 카드는 앰버 강조 + '이어서 작성' 액션.

import Link from 'next/link';
import { ApplicationResult } from '@prisma/client';
import type { MyApplicationCard, MyDraftCard } from '@/lib/my-page/types';
import { resultLabel } from '@/lib/my-page/stage-labels';
import { StageProgress } from '@/app/me/_components/StageProgress';
import { DiscardDraftButton } from '@/app/me/_components/DiscardDraftButton';
import styles from '@/app/me/me.module.css';

/** 결과 → 배지 표시(텍스트·톤). 진행 중이면 현재 단계 라벨을 노출. */
function resultBadge(card: MyApplicationCard): {
  text: string;
  tone: string | undefined; // CSS Module 클래스 — noUncheckedIndexedAccess로 optional
} {
  switch (card.result) {
    case ApplicationResult.PASSED:
      return { text: resultLabel(card.result), tone: styles.success };
    case ApplicationResult.FAILED:
      return { text: resultLabel(card.result), tone: styles.failed };
    case ApplicationResult.WITHDRAWN:
      return { text: resultLabel(card.result), tone: styles.withdrawn };
    default: // IN_PROGRESS — 현재 전형 단계를 강조
      return { text: card.currentStageLabel, tone: styles.info };
  }
}

interface ApplicationCardProps {
  card: MyApplicationCard;
}

export function ApplicationCard({ card }: ApplicationCardProps) {
  const formattedSubmittedAt = new Date(card.submittedAt).toLocaleDateString('ko-KR');
  const formattedChangedAt = new Date(card.lastStatusChangedAt).toLocaleDateString('ko-KR');
  const badge = resultBadge(card);

  return (
    <article className={styles.card} aria-labelledby={`app-${card.applicationId}-title`}>
      <div className={styles.cardHead}>
        <h3 id={`app-${card.applicationId}-title`} className={styles.cardTitle}>
          <Link href={`/me/${card.applicationId}`} className={styles.titleLink}>
            {card.jobTitle}
          </Link>
        </h3>
        <span className={`${styles.badge} ${badge.tone}`}>
          <span className={styles.badgeDot} aria-hidden="true" />
          {badge.text}
        </span>
      </div>

      <p className={styles.cardNumber}>{card.applicationNumber}</p>

      <StageProgress currentStage={card.currentStage} result={card.result} />

      <div className={styles.cardFooter}>
        <p className={styles.cardMeta}>
          <span>
            제출 <time dateTime={card.submittedAt}>{formattedSubmittedAt}</time>
          </span>
          <span>
            변경 <time dateTime={card.lastStatusChangedAt}>{formattedChangedAt}</time>
          </span>
        </p>
        <span className={styles.detailLink} aria-hidden="true">
          상세 ›
        </span>
      </div>
    </article>
  );
}

interface DraftCardProps {
  card: MyDraftCard;
}

export function DraftCard({ card }: DraftCardProps) {
  const formattedSavedAt = new Date(card.lastSavedAt).toLocaleString('ko-KR');
  const isClosedJob = card.jobStatus === 'CLOSED';

  return (
    <article
      className={`${styles.card} ${styles.draftCard}`}
      aria-labelledby={`draft-${card.draftId}-title`}
    >
      <div className={styles.cardHead}>
        <h3 id={`draft-${card.draftId}-title`} className={styles.cardTitle}>
          {card.jobTitle}
        </h3>
        <span className={`${styles.badge} ${styles.draft}`}>
          <span className={styles.badgeDot} aria-hidden="true" />
          작성 중
        </span>
      </div>

      <p className={styles.cardMeta}>
        <span>
          마지막 저장 <time dateTime={card.lastSavedAt}>{formattedSavedAt}</time>
        </span>
      </p>

      {isClosedJob && (
        <p className={styles.draftClosedNote}>공고 마감 — 이어서 작성할 수 없습니다.</p>
      )}
      <div className={styles.draftActions}>
        {!isClosedJob && (
          <Link href={`/jobs/${card.jobPostingId}/apply`} className={styles.draftAction}>
            이어서 작성 ›
          </Link>
        )}
        <DiscardDraftButton jobPostingId={card.jobPostingId} />
      </div>
    </article>
  );
}
