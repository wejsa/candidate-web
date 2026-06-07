// CANDID-058 — 홈/메타 카피 회귀 가드.
// RSC/CSS module import를 피하려 소스를 텍스트로 읽어 검사한다(정적 카피 검증이므로 충분).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const pageSrc = readFileSync(resolve(root, 'app/page.tsx'), 'utf8');
const layoutSrc = readFileSync(resolve(root, 'app/layout.tsx'), 'utf8');

describe('홈/메타 카피 "세상을 움직인다" 테마 (CANDID-058 → CANDID-059)', () => {
  it('"무인 환전" 표현이 홈/루트 레이아웃 카피에 존재하지 않음', () => {
    expect(pageSrc).not.toMatch(/무인\s*환전/);
    expect(layoutSrc).not.toMatch(/무인\s*환전/);
  });

  it('직전 "일상을 잇는 금융 플랫폼" 표현이 더 이상 남아있지 않음', () => {
    expect(pageSrc).not.toContain('일상을 잇는 금융 플랫폼');
    expect(layoutSrc).not.toContain('일상을 잇는 금융 플랫폼');
  });

  it('"세상을 움직" 테마 문구가 H1·메타·히어로에 반영됨', () => {
    expect(pageSrc).toContain('함께 세상을 움직일 엔지니어를 찾습니다');
    expect(pageSrc).toContain('세상을 움직이는 플랫폼');
    expect(layoutSrc).toContain('세상을 움직이는 플랫폼');
  });
});
