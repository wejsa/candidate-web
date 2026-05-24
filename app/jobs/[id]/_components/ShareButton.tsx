// CANDID-014 Step 2 — URL 복사 공유 버튼 (client).
// navigator.clipboard.writeText 우선 + document.execCommand('copy') fallback.
// 카카오톡/링크드인 SDK는 P2 후속 task.

'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  title: string;
}

type Status = 'idle' | 'copied' | 'failed';

async function copyToClipboard(text: string): Promise<boolean> {
  // Clipboard API (HTTPS + 권한)
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 권한 거부 등 — fallback 시도
    }
  }
  // Legacy fallback — Safari iOS 13 이하 등
  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  // CANDID-014 Step 3 (S-INFO carry): 스크린리더/탭 포커스 노출 차단.
  textarea.setAttribute('aria-hidden', 'true');
  textarea.setAttribute('tabindex', '-1');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    // document.execCommand는 deprecated이나 Safari iOS<14 fallback용 의도적 사용.
    const ok = document.execCommand('copy');
    return ok;
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

export function ShareButton({ title }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  // CANDID-014 Step 3 L-019 (D-MAJOR-5): unmount 후 setState 회귀 차단 — ref 보관 + cleanup.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleClick = async () => {
    // CANDID-014 Step 3 (S-INFO carry): origin + pathname만 공유 — 쿼리/해시 토큰 누수 차단.
    const url =
      typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '';
    const ok = await copyToClipboard(url);
    setStatus(ok ? 'copied' : 'failed');
    // 토스트 3초 후 초기화 — 직전 타이머 취소 후 새로 등록.
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setStatus('idle'), 3000);
  };

  return (
    <div>
      <button type="button" onClick={handleClick} aria-label={`${title} URL 복사`}>
        URL 복사
      </button>
      {status === 'copied' && (
        <span role="status" aria-live="polite">
          복사 완료
        </span>
      )}
      {status === 'failed' && (
        <span role="status" aria-live="assertive">
          복사 실패 — 직접 URL을 복사하세요
        </span>
      )}
    </div>
  );
}
