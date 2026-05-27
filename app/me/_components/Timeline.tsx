// CANDID-019 Step 3 — 전형 진행 타임라인 (US-MY-002).

import type { TimelineEntry } from '@/lib/my-page/types';
import { stageLabel } from '@/lib/my-page/stage-labels';

interface TimelineProps {
  entries: TimelineEntry[];
}

export function Timeline({ entries }: TimelineProps) {
  if (entries.length === 0) {
    return (
      <div role="status" aria-live="polite">
        <p>아직 변경 이력이 없습니다.</p>
      </div>
    );
  }
  return (
    <ol aria-label="전형 진행 타임라인">
      {entries.map((entry) => {
        const fromLabel = entry.fromStage === null ? '시작' : stageLabel(entry.fromStage);
        const dateLabel = new Date(entry.changedAt).toLocaleString('ko-KR');
        return (
          <li key={entry.id}>
            <span aria-label="변경 단계">
              {fromLabel} → {entry.toStageLabel}
            </span>
            <time dateTime={entry.changedAt}>{dateLabel}</time>
          </li>
        );
      })}
    </ol>
  );
}
