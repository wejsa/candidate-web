// CANDID-019 Step 3 / 대시보드 재구성 — 빈 섹션 표시(점선 카드 + 아이콘).

import type { ReactNode } from 'react';
import styles from '@/app/me/me.module.css';

interface EmptyStateProps {
  message: string;
  cta?: ReactNode;
}

export function EmptyState({ message, cta }: EmptyStateProps) {
  return (
    <div className={styles.empty} role="status" aria-live="polite">
      <span className={styles.emptyIcon} aria-hidden="true" />
      <p>{message}</p>
      {cta !== undefined && cta !== null ? <div>{cta}</div> : null}
    </div>
  );
}
