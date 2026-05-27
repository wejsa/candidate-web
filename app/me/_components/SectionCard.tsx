// CANDID-019 Step 3 — 지원 내역 카드 (작성중/진행중/종료 공통 + 변형).

import Link from 'next/link';
import type {
  MyApplicationCard,
  MyDraftCard,
} from '@/lib/my-page/types';
import { resultLabel } from '@/lib/my-page/stage-labels';

interface ApplicationCardProps {
  card: MyApplicationCard;
}

export function ApplicationCard({ card }: ApplicationCardProps) {
  const formattedSubmittedAt = new Date(card.submittedAt).toLocaleDateString('ko-KR');
  const formattedChangedAt = new Date(card.lastStatusChangedAt).toLocaleDateString('ko-KR');
  return (
    <article aria-labelledby={`app-${card.applicationId}-title`}>
      <Link href={`/me/${card.applicationId}`}>
        <h3 id={`app-${card.applicationId}-title`}>{card.jobTitle}</h3>
      </Link>
      <dl>
        <dt>지원 번호</dt>
        <dd>{card.applicationNumber}</dd>
        <dt>제출일</dt>
        <dd>
          <time dateTime={card.submittedAt}>{formattedSubmittedAt}</time>
        </dd>
        <dt>현재 상태</dt>
        <dd>{card.currentStageLabel}</dd>
        <dt>결과</dt>
        <dd>{resultLabel(card.result)}</dd>
        <dt>상태 변경일</dt>
        <dd>
          <time dateTime={card.lastStatusChangedAt}>{formattedChangedAt}</time>
        </dd>
      </dl>
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
    <article aria-labelledby={`draft-${card.draftId}-title`}>
      <h3 id={`draft-${card.draftId}-title`}>{card.jobTitle}</h3>
      <dl>
        <dt>마지막 저장</dt>
        <dd>
          <time dateTime={card.lastSavedAt}>{formattedSavedAt}</time>
        </dd>
        {isClosedJob ? (
          <>
            <dt>공고 상태</dt>
            <dd>마감 — 이어서 작성 불가</dd>
          </>
        ) : null}
      </dl>
      {isClosedJob ? null : (
        <Link href={`/jobs/${card.jobPostingId}/apply`}>이어서 작성</Link>
      )}
    </article>
  );
}
