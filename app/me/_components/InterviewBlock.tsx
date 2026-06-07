// CANDID-019 Step 3 — 면접 일정 블록.

import type { InterviewSummary } from '@/lib/my-page/types';
import { interviewStatusLabel } from '@/lib/my-page/stage-labels';

interface InterviewBlockProps {
  interviews: InterviewSummary[];
}

export function InterviewBlock({ interviews }: InterviewBlockProps) {
  if (interviews.length === 0) {
    return (
      <div role="status" aria-live="polite">
        <p>예정된 면접 일정이 없습니다.</p>
      </div>
    );
  }
  return (
    <ul aria-label="면접 일정 목록">
      {interviews.map((iv) => {
        const dateLabel = new Date(iv.scheduledAt).toLocaleString('ko-KR');
        return (
          <li key={iv.scheduleId}>
            <h4>{iv.stageLabel}</h4>
            <dl>
              <dt>일시</dt>
              <dd>
                <time dateTime={iv.scheduledAt}>{dateLabel}</time>
              </dd>
              <dt>장소 / 화상 회의 URL</dt>
              <dd>{iv.locationOrUrl}</dd>
              <dt>상태</dt>
              <dd>{interviewStatusLabel(iv.status)}</dd>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
