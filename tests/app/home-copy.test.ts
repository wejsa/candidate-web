// CANDID-058 — 홈/메타 카피 회귀 가드.
// RSC/CSS module import를 피하려 소스를 텍스트로 읽어 검사한다(정적 카피 검증이므로 충분).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const pageSrc = readFileSync(resolve(root, 'app/page.tsx'), 'utf8');
const layoutSrc = readFileSync(resolve(root, 'app/layout.tsx'), 'utf8');

describe('홈/메타 카피 "일상을 편리하게" 톤 (CANDID-058 → 059 → 060)', () => {
  it('"무인 환전" 표현이 홈/루트 레이아웃 카피에 존재하지 않음', () => {
    expect(pageSrc).not.toMatch(/무인\s*환전/);
    expect(layoutSrc).not.toMatch(/무인\s*환전/);
  });

  it('직전 톤("일상을 잇는 금융 플랫폼"/"세상을 움직")이 더 이상 남아있지 않음', () => {
    expect(pageSrc).not.toContain('일상을 잇는 금융 플랫폼');
    expect(pageSrc).not.toMatch(/세상을\s*움직/);
    expect(layoutSrc).not.toContain('일상을 잇는 금융 플랫폼');
    expect(layoutSrc).not.toMatch(/세상을\s*움직/);
  });

  it('"일상을 편리하게" 톤 문구가 H1·메타·히어로에 반영됨', () => {
    expect(pageSrc).toContain('함께 일상을 바꿀 엔지니어를 찾습니다');
    expect(pageSrc).toContain('일상을 더 편리하게 만드는 솔루션');
    expect(layoutSrc).toContain('일상을 더 편리하게 만드는 솔루션');
  });
});
