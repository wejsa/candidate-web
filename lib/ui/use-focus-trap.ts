// CANDID-028 Step 2 — 모달 focus 관리 재사용 훅 (WCAG 2.4.3 Focus Order).
//
// 모달이 활성(마운트)되는 동안:
//   ① 직전 포커스 요소를 저장
//   ② 컨테이너 내부에 포커스가 없으면 첫 focusable로 이동
//   ③ Tab/Shift+Tab을 컨테이너 경계에서 순환(trap) — 키보드가 모달 밖으로 새지 않음
//   ④ Escape → onEscape 콜백 (모달 닫기 위임)
//   ⑤ body 스크롤 락 (배경 스크롤 방지)
// 비활성(언마운트) 시 직전 포커스를 복원한다.
//
// 비고: 두 모달(ConfirmModal/WithdrawButton)은 in-page 조건부 렌더이므로 portal 기반
//   배경 inert는 적용하지 않는다. 대신 focus-trap(키보드 격리) + aria-modal="true"(AT 신호)
//   + 스크롤 락으로 AA 요구를 충족한다. 완전한 background `inert`는 portal 도입 시 후속 개선.

'use client';

import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function useFocusTrap<T extends HTMLElement>(
  active: boolean,
  onEscape?: () => void,
): React.RefObject<T> {
  const ref = useRef<T>(null);
  // onEscape를 ref로 보관 — 콜백 변경이 effect 재실행/리스너 재등록을 유발하지 않게.
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    const container = ref.current;
    if (!active || container === null) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    // 초기 포커스: 모달 내부에 포커스가 없을 때만 첫 focusable로 이동
    // (autoFocus 등으로 이미 내부에 포커스가 있으면 존중).
    if (!container.contains(document.activeElement)) {
      focusables()[0]?.focus();
    }

    // body 스크롤 락
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onEscapeRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;

      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;

      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last?.focus();
        }
      } else if (activeEl === last || !container.contains(activeEl)) {
        e.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      // 트리거 요소로 포커스 복원 (모달 닫힘 후 키보드 맥락 유지).
      previouslyFocused?.focus?.();
    };
  }, [active]);

  return ref;
}
