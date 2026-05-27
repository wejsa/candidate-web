// CANDID-019 Step 3 — 빈 섹션 표시.

import type { ReactNode } from 'react';

interface EmptyStateProps {
  message: string;
  cta?: ReactNode;
}

export function EmptyState({ message, cta }: EmptyStateProps) {
  return (
    <div role="status" aria-live="polite">
      <p>{message}</p>
      {cta !== undefined && cta !== null ? <div>{cta}</div> : null}
    </div>
  );
}
