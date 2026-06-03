// CANDID-028 Step 2 — useFocusTrap 단위 테스트 (RTL, jsdom).
// 검증: 초기 포커스 이동, ESC 콜백, Tab/Shift+Tab 경계 순환(trap), body 스크롤락, 포커스 복원.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useFocusTrap } from '@/lib/ui/use-focus-trap';

function Harness({ active, onEscape }: { active: boolean; onEscape?: () => void }): React.JSX.Element {
  const ref = useFocusTrap<HTMLDivElement>(active, onEscape);
  return (
    <div>
      <button data-testid="outside" type="button">
        outside
      </button>
      {active && (
        <div ref={ref} role="dialog" aria-modal="true">
          <button data-testid="first" type="button">
            first
          </button>
          <button data-testid="mid" type="button">
            mid
          </button>
          <button data-testid="last" type="button">
            last
          </button>
        </div>
      )}
    </div>
  );
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('useFocusTrap', () => {
  it('활성화 시 컨테이너 첫 focusable로 포커스를 이동한다', () => {
    const { getByTestId, rerender } = render(<Harness active={false} />);
    getByTestId('outside').focus();
    expect(document.activeElement).toBe(getByTestId('outside'));

    rerender(<Harness active />);
    expect(document.activeElement).toBe(getByTestId('first'));
  });

  it('Escape 키는 onEscape를 호출한다', () => {
    const onEscape = vi.fn();
    render(<Harness active onEscape={onEscape} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('마지막 요소에서 Tab은 첫 요소로 순환한다', () => {
    const { getByTestId } = render(<Harness active />);
    getByTestId('last').focus();
    fireEvent.keyDown(getByTestId('last'), { key: 'Tab' });
    expect(document.activeElement).toBe(getByTestId('first'));
  });

  it('첫 요소에서 Shift+Tab은 마지막 요소로 순환한다', () => {
    const { getByTestId } = render(<Harness active />);
    getByTestId('first').focus();
    fireEvent.keyDown(getByTestId('first'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(getByTestId('last'));
  });

  it('활성 동안 body 스크롤을 잠그고 비활성 시 복원한다', () => {
    const { rerender } = render(<Harness active={false} />);
    expect(document.body.style.overflow).toBe('');
    rerender(<Harness active />);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<Harness active={false} />);
    expect(document.body.style.overflow).toBe('');
  });

  it('비활성화 시 직전 포커스 요소로 복원한다', () => {
    const { getByTestId, rerender } = render(<Harness active={false} />);
    getByTestId('outside').focus();
    rerender(<Harness active />);
    expect(document.activeElement).toBe(getByTestId('first'));
    rerender(<Harness active={false} />);
    expect(document.activeElement).toBe(getByTestId('outside'));
  });

  // --- 리뷰 보강: negative/edge 분기 (disabled 제외 / 외부 포커스 재진입 / focusables 0 / overflow 복원 / 제거된 트리거) ---

  it('disabled 요소는 trap 경계에서 제외된다', () => {
    function H(): React.JSX.Element {
      const ref = useFocusTrap<HTMLDivElement>(true);
      return (
        <div ref={ref} role="dialog" aria-modal="true">
          <button data-testid="first" type="button">
            first
          </button>
          <button data-testid="disabled-last" type="button" disabled>
            disabled
          </button>
        </div>
      );
    }
    const { getByTestId } = render(<H />);
    getByTestId('first').focus(); // 활성 focusable이 first 하나뿐 → 경계
    fireEvent.keyDown(getByTestId('first'), { key: 'Tab' });
    expect(document.activeElement).toBe(getByTestId('first')); // disabled로 이동하지 않음
  });

  it('포커스가 컨테이너 밖에 있을 때 Tab은 첫 요소로 강제 재진입한다', () => {
    const { getByTestId } = render(<Harness active />);
    getByTestId('outside').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(getByTestId('first'));
  });

  it('focusable이 0개여도 Tab 처리 시 throw하지 않는다', () => {
    function H(): React.JSX.Element {
      const ref = useFocusTrap<HTMLDivElement>(true);
      return (
        <div ref={ref} role="dialog" aria-modal="true">
          <p>focusable 없음</p>
        </div>
      );
    }
    render(<H />);
    expect(() => fireEvent.keyDown(document, { key: 'Tab' })).not.toThrow();
  });

  it('직전 overflow 값을 보존해 복원한다 (빈 문자열 아님)', () => {
    document.body.style.overflow = 'scroll';
    const { rerender } = render(<Harness active />);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<Harness active={false} />);
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('복원 대상이 DOM에서 제거돼도 throw하지 않는다 (isConnected 가드)', () => {
    const { getByTestId, rerender } = render(<Harness active={false} />);
    getByTestId('outside').focus();
    rerender(<Harness active />);
    getByTestId('outside').remove(); // 트리거가 navigate/refresh로 사라진 상황
    expect(() => rerender(<Harness active={false} />)).not.toThrow();
  });
});
