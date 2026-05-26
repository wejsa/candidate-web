// CANDID-017 Step 1 — allowed-domains 단위 테스트.

import { describe, expect, it } from 'vitest';
import { ALLOWED_HOSTS, isAllowedHost } from '@/lib/portfolios/allowed-domains';
import { LINK_TYPES } from '@/lib/portfolios/types';

describe('isAllowedHost', () => {
  it.each([
    ['GITHUB', 'github.com', true],
    ['GITHUB', 'gist.github.com', true],
    ['GITHUB', 'bitbucket.org', false],
    ['GITHUB', 'evil-github.com', false],
    ['GITHUB', 'github.com.evil', false],
  ] as const)('GITHUB: %s → %s', (lt, host, expected) => {
    expect(isAllowedHost(lt, host)).toBe(expected);
  });

  it.each([
    ['NOTION', 'notion.so', true],
    ['NOTION', 'www.notion.so', true],
    ['NOTION', 'jaese.notion.site', true],
    ['NOTION', 'my-workspace-123.notion.site', true],
    ['NOTION', 'notion.com', false],
    ['NOTION', 'fake.notion.evil.site', false],
  ] as const)('NOTION: %s → %s', (lt, host, expected) => {
    expect(isAllowedHost(lt, host)).toBe(expected);
  });

  it.each([
    ['LINKEDIN', 'linkedin.com', true],
    ['LINKEDIN', 'www.linkedin.com', true], // H003 fix
    ['LINKEDIN', 'kr.linkedin.com', true],
    ['LINKEDIN', 'careers.linkedin.com', true], // H003 fix
    ['LINKEDIN', 'learning.linkedin.com', true], // H003 fix
    ['LINKEDIN', 'fake-linkedin.com', false],
    ['LINKEDIN', 'evil.linkedin.com', false],
  ] as const)('LINKEDIN: %s → %s', (lt, host, expected) => {
    expect(isAllowedHost(lt, host)).toBe(expected);
  });

  it.each([
    ['FIGMA', 'figma.com', true],
    ['FIGMA', 'www.figma.com', true], // H003 fix
    ['FIGMA', 'kr.figma.com', true],
    ['FIGMA', 'sketch.com', false],
  ] as const)('FIGMA: %s → %s', (lt, host, expected) => {
    expect(isAllowedHost(lt, host)).toBe(expected);
  });

  it('BLOG/ETC는 자유 도메인 (null) — 항상 true', () => {
    expect(isAllowedHost('BLOG', 'anything.example.com')).toBe(true);
    expect(isAllowedHost('BLOG', 'velog.io')).toBe(true);
    expect(isAllowedHost('ETC', 'devblog.com')).toBe(true);
  });

  it('대문자 hostname도 정상 매칭 (lowercase 정규화)', () => {
    expect(isAllowedHost('GITHUB', 'GITHUB.COM')).toBe(true);
    expect(isAllowedHost('NOTION', 'Workspace.Notion.Site')).toBe(true);
  });
});

// H008 fix (PR #65 review) — ALLOWED_HOSTS SSOT 동기화 메타 가드.
// LINK_TYPES와 ALLOWED_HOSTS의 키 집합이 정확히 일치해야 함을 강제. 신규 linkType이
// LINK_TYPES에 추가되었으나 ALLOWED_HOSTS에 누락되면(또는 반대) 본 테스트가 fail.
describe('ALLOWED_HOSTS SSOT — LINK_TYPES와 키 집합 일치 (H008 fix)', () => {
  it('ALLOWED_HOSTS는 LINK_TYPES의 모든 키를 포함', () => {
    for (const lt of LINK_TYPES) {
      expect(lt in ALLOWED_HOSTS).toBe(true);
    }
  });

  it('ALLOWED_HOSTS의 키는 LINK_TYPES와 정확히 일치 (양방향 exhaustiveness)', () => {
    expect(Object.keys(ALLOWED_HOSTS).sort()).toEqual([...LINK_TYPES].sort());
  });
});
