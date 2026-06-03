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
});
