// CANDID-017 Step 1 — allowed-domains 단위 테스트.

import { describe, expect, it } from 'vitest';
import { isAllowedHost } from '@/lib/portfolios/allowed-domains';

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
    ['LINKEDIN', 'kr.linkedin.com', true],
    ['LINKEDIN', 'fake-linkedin.com', false],
  ] as const)('LINKEDIN: %s → %s', (lt, host, expected) => {
    expect(isAllowedHost(lt, host)).toBe(expected);
  });

  it.each([
    ['FIGMA', 'figma.com', true],
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
