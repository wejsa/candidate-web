// CANDID — 전형 진행바(4단계 스테퍼). 마이페이지 A안 대시보드용.
//
// 전형 단계(StageType, 7종)를 4개 마일스톤(제출·서류·면접·최종)으로 압축해 시각화한다.
// 결과(ApplicationResult)가 진행바 톤(색)과 완료 여부를 결정한다:
//  - IN_PROGRESS → 현재 단계까지 채움(파랑), 이후 단계는 대기
//  - PASSED      → 전 단계 완료(초록)
//  - FAILED      → 전형 종료(빨강) — 단계 도달 위치는 알 수 없어 '종료'로 표기
//  - WITHDRAWN   → 전형 종료(뮤트)

import { ApplicationResult, StageType } from '@prisma/client';
import styles from '@/app/me/me.module.css';

const MILESTONES = ['제출', '서류', '면접', '최종'] as const;

/** IN_PROGRESS 단계 → 마일스톤 인덱스(0~3). */
const STAGE_TO_MILESTONE: Record<StageType, number> = {
  [StageType.SUBMITTED]: 0,
  [StageType.DOC_REVIEW]: 1,
  [StageType.INTERVIEW_1]: 2,
  [StageType.INTERVIEW_2]: 2,
  [StageType.OFFER]: 3,
  [StageType.HIRED]: 3,
  [StageType.REJECTED]: 3,
};

type Tone = 'info' | 'success' | 'danger' | 'muted';

interface Props {
  currentStage: StageType;
  result: ApplicationResult;
}

export function StageProgress({ currentStage, result }: Props) {
  // 결과가 종료 상태면 전 단계 완료로 그린다(여정 종료). 진행 중이면 현재 단계까지.
  let tone: Tone;
  let activeIndex: number;
  let terminal: boolean;

  switch (result) {
    case ApplicationResult.PASSED:
      tone = 'success';
      activeIndex = MILESTONES.length - 1;
      terminal = true;
      break;
    case ApplicationResult.FAILED:
      tone = 'danger';
      activeIndex = MILESTONES.length - 1;
      terminal = true;
      break;
    case ApplicationResult.WITHDRAWN:
      tone = 'muted';
      activeIndex = MILESTONES.length - 1;
      terminal = true;
      break;
    default: // IN_PROGRESS
      tone = 'info';
      activeIndex = STAGE_TO_MILESTONE[currentStage];
      terminal = false;
  }

  return (
    <ol
      className={`${styles.progress} ${styles[`tone-${tone}`]}`}
      aria-label="전형 진행 단계"
    >
      {MILESTONES.map((label, i) => {
        // terminal(종료)이면 모든 단계 done. 진행 중이면 activeIndex가 current.
        const state =
          terminal || i < activeIndex
            ? 'done'
            : i === activeIndex
              ? 'current'
              : 'todo';
        return (
          <li
            key={label}
            className={`${styles.progressStep} ${styles[state]}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.stepLabel}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
