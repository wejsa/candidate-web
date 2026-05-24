// CANDID-015 Step 4 — 자동 저장 상태 토스트 + lastSavedAt 표시.

'use client';

import type { AutoSaveStatus } from '@/lib/drafts/use-auto-save';

interface Props {
  status: AutoSaveStatus;
  lastSavedAt: string;
  version: number;
  errorMessage: string | null;
  onSaveNow: () => void;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const STATUS_LABEL: Record<AutoSaveStatus, string> = {
  idle: '',
  saving: '저장 중…',
  saved: '임시 저장됨',
  failed: '저장 실패',
  conflict: '다른 곳에서 변경됨',
};

export function AutoSaveIndicator({
  status,
  lastSavedAt,
  version,
  errorMessage,
  onSaveNow,
}: Props) {
  const label = STATUS_LABEL[status];
  return (
    <aside aria-label="자동 저장 상태">
      <button type="button" onClick={onSaveNow} aria-label="지금 저장">
        지금 저장
      </button>
      <span role="status" aria-live="polite">
        {label !== '' && <strong>{label}</strong>}
        {status !== 'failed' && status !== 'conflict' && (
          <span> · {formatTime(lastSavedAt)} (v{version})</span>
        )}
        {(status === 'failed' || status === 'conflict') && errorMessage !== null && (
          <span role="alert"> · {errorMessage}</span>
        )}
      </span>
    </aside>
  );
}
