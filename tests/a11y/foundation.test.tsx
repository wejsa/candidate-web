// CANDID-028 Step 1 — a11y/반응형 파운데이션 회귀 가드.
//
// 3축 검증:
//  (1) vitest-axe 하니스 자체 검증 (L-034: 가드 도입 PR은 가드 자체를 테스트) —
//      라벨 있는 폼은 통과, 라벨 없는 input은 검출. matcher 양방향 동작 증명.
//  (2) layout.tsx viewport export — 모바일 reflow 전제 + 사용자 확대 미차단(접근성).
//  (3) globals.css 파운데이션 primitive 존재 — focus-visible/반응형/reduced-motion/터치타깃/유틸·토큰.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { viewport } from '@/app/layout';

// 문서 레벨 룰(html-lang/document-title/landmark 등)은 jsdom 단편 렌더에서 노이즈이므로
// 하니스 검증은 'label' 룰만 실행해 "라벨 누락 검출" 능력에 한정한다.
const LABEL_ONLY = { runOnly: ['label'] };

afterEach(() => {
  cleanup();
});

describe('vitest-axe 하니스', () => {
  it('라벨이 연결된 폼은 위반이 없다', async () => {
    const { container } = render(
      <label>
        이름
        <input type="text" />
      </label>,
    );
    expect(await axe(container, LABEL_ONLY)).toHaveNoViolations();
  });

  it('라벨이 없는 input은 위반으로 검출한다', async () => {
    const { container } = render(<input type="text" />);
    const results = await axe(container, LABEL_ONLY);
    expect(results.violations.length).toBeGreaterThan(0);
    expect(results.violations.map((v) => v.id)).toContain('label');
  });
});

describe('layout viewport (반응형 전제)', () => {
  it('device-width + initialScale 1', () => {
    expect(viewport.width).toBe('device-width');
    expect(viewport.initialScale).toBe(1);
  });

  it('사용자 확대를 차단하지 않는다 (접근성)', () => {
    // userScalable=false / maximumScale=1 은 확대를 막아 저시력 사용자를 배제한다 → 설정 금지.
    expect(viewport.userScalable).not.toBe(false);
    expect(viewport.maximumScale).toBeUndefined();
  });
});

describe('globals.css 파운데이션 primitive', () => {
  const css = readFileSync(path.resolve(process.cwd(), 'app/globals.css'), 'utf8');

  it.each([
    [':focus-visible', ':focus-visible'], // WCAG 2.4.7
    ['반응형 breakpoint', '@media (min-width: 768px)'], // WCAG 1.4.10
    ['reduced-motion', 'prefers-reduced-motion'], // WCAG 2.3.3
    ['터치 타깃 토큰', '--touch-min: 44px'], // WCAG 2.5.5/2.5.8
    ['visually-hidden 유틸', '.visually-hidden'],
    ['skip-link 유틸', '.skip-link'],
    ['포커스 색 토큰', '--color-focus'],
    ['링크 색 토큰', '--color-link: #0066cc'],
  ])('%s 규칙을 포함한다', (_label, needle) => {
    expect(css).toContain(needle);
  });
});
