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

// 주석(/* ... */)을 제거해 "주석 안 needle"이 false-pass하지 않게 한다(리뷰 H003 보강).
// 예: 헤더 주석의 `--color-link: #0066cc`가 실제 규칙 삭제 시에도 통과하던 문제 차단.
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('globals.css 파운데이션 primitive', () => {
  const css = stripCssComments(readFileSync(path.resolve(process.cwd(), 'app/globals.css'), 'utf8'));

  // 문자열 존재(toContain)가 아닌 "셀렉터-속성 결합/값"을 정규식으로 단언해 무성 실패를 막는다.
  it.each<[string, RegExp]>([
    // WCAG 2.4.7 — :focus-visible 블록이 실제 가시 outline(none 아님)을 선언해야 한다.
    ['focus-visible 가시 outline', /:focus-visible\s*\{[^}]*outline:\s*3px\s+solid/],
    // WCAG 1.4.10 — 768px 또는 동등값(48rem) 허용(리팩토링 내성).
    ['반응형 breakpoint', /@media\s*\(min-width:\s*(768px|48rem)\)/],
    ['reduced-motion', /prefers-reduced-motion/], // WCAG 2.3.3
    ['터치 타깃 토큰 정의', /--touch-min:\s*44px/], // WCAG 2.5.5/2.5.8
    ['터치 타깃 실제 적용', /min-height:\s*var\(--touch-min\)/], // 선언만이 아니라 적용까지 가드
    ['visually-hidden 유틸', /\.visually-hidden\s*\{/],
    ['skip-link 유틸', /\.skip-link\s*\{/],
    ['포커스 색 토큰', /--color-focus:\s*#[0-9a-fA-F]{6}/],
    ['링크 색 토큰', /--color-link:\s*#0066cc/],
  ])('%s 규칙을 포함한다', (_label, re) => {
    expect(css).toMatch(re);
  });
});

// 대비 회귀 가드 (리뷰 H005): jsdom은 axe color-contrast를 스킵하므로, 토큰 hex를 CSS에서
// 직접 파싱해 WCAG 상대휘도 공식으로 대비비를 계산·단언한다. 토큰 색을 옅게 바꾸면 실패한다.
describe('globals.css 색 토큰 대비비 (WCAG 1.4.3 / 1.4.11)', () => {
  const css = stripCssComments(readFileSync(path.resolve(process.cwd(), 'app/globals.css'), 'utf8'));

  function token(name: string): string {
    const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
    if (value === undefined) throw new Error(`token --${name} 미정의`);
    return value;
  }
  function luminance(hex: string): number {
    const ch = (i: number): number => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
  }
  function contrast(a: string, b: string): number {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  const bg = token('color-bg');
  const WHITE = '#ffffff';

  it.each<[string, () => number, number]>([
    // 텍스트/링크/에러: WCAG 1.4.3 4.5:1 이상
    ['본문 텍스트', () => contrast(token('color-text'), bg), 4.5],
    ['보조 텍스트', () => contrast(token('color-text-muted'), bg), 4.5],
    ['링크', () => contrast(token('color-link'), bg), 4.5],
    ['에러', () => contrast(token('color-error'), bg), 4.5],
    ['버튼 흰 글자 on 링크색', () => contrast(WHITE, token('color-link')), 4.5],
    // 비텍스트 UI(경계/포커스링): WCAG 1.4.11 3:1 이상
    ['폼 경계', () => contrast(token('color-border'), bg), 3],
    ['포커스 링', () => contrast(token('color-focus'), bg), 3],
  ])('%s 대비 ≥ %d:1', (_label, compute, threshold) => {
    expect(compute()).toBeGreaterThanOrEqual(threshold);
  });
});
