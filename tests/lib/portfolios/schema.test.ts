// CANDID-017 Step 1 — portfolios/schema 단위 테스트.

import { describe, expect, it } from 'vitest';
import {
  PortfolioLinkInputSchema,
  PortfolioLinksRequestSchema,
} from '@/lib/portfolios/schema';

describe('PortfolioLinkInputSchema', () => {
  it('정상 GITHUB URL은 통과 + memo null로 정규화', () => {
    const parsed = PortfolioLinkInputSchema.safeParse({
      linkType: 'GITHUB',
      url: 'https://github.com/owner/repo',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.memo).toBeNull();
    }
  });

  it('memo 공백만은 null로 정규화', () => {
    const parsed = PortfolioLinkInputSchema.safeParse({
      linkType: 'BLOG',
      url: 'https://my-blog.example.com',
      memo: '   ',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.memo).toBeNull();
  });

  it.each([
    'http://github.com',
    'ftp://github.com',
    'javascript:alert(1)',
    'not-a-url',
  ])('http/non-https URL은 거부: %s', (badUrl) => {
    const parsed = PortfolioLinkInputSchema.safeParse({
      linkType: 'GITHUB',
      url: badUrl,
    });
    expect(parsed.success).toBe(false);
  });

  it.each([
    'https://10.0.0.1/repo',
    'https://192.168.0.1',
    'https://169.254.169.254/meta',
    'https://127.0.0.1:8080',
  ])('private/metadata IP URL은 거부: %s', (badUrl) => {
    const parsed = PortfolioLinkInputSchema.safeParse({
      linkType: 'BLOG',
      url: badUrl,
    });
    expect(parsed.success).toBe(false);
  });

  it('GITHUB linkType + bitbucket URL은 화이트리스트 위반 거부', () => {
    const parsed = PortfolioLinkInputSchema.safeParse({
      linkType: 'GITHUB',
      url: 'https://bitbucket.org/owner/repo',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path[0] === 'url')).toBe(true);
    }
  });

  it('NOTION + workspace.notion.site 통과', () => {
    const parsed = PortfolioLinkInputSchema.safeParse({
      linkType: 'NOTION',
      url: 'https://jaese.notion.site/my-portfolio',
    });
    expect(parsed.success).toBe(true);
  });

  it('ETC + 임의 https 도메인 통과', () => {
    const parsed = PortfolioLinkInputSchema.safeParse({
      linkType: 'ETC',
      url: 'https://my-portfolio.example.com',
    });
    expect(parsed.success).toBe(true);
  });

  it('memo 500자 초과 거부', () => {
    const parsed = PortfolioLinkInputSchema.safeParse({
      linkType: 'BLOG',
      url: 'https://example.com',
      memo: 'x'.repeat(501),
    });
    expect(parsed.success).toBe(false);
  });

  it('linkType enum 외 값 거부', () => {
    const parsed = PortfolioLinkInputSchema.safeParse({
      linkType: 'TWITTER',
      url: 'https://example.com',
    });
    expect(parsed.success).toBe(false);
  });

  // H009 fix (PR #65 review) — inclusive boundary 케이스.
  it('memo 정확히 500자는 통과 (inclusive boundary)', () => {
    const parsed = PortfolioLinkInputSchema.safeParse({
      linkType: 'BLOG',
      url: 'https://example.com',
      memo: 'x'.repeat(500),
    });
    expect(parsed.success).toBe(true);
  });

  it('url 정확히 1000자는 통과, 1001자는 거부 (inclusive boundary)', () => {
    const padded = 'https://example.com/' + 'a'.repeat(1000 - 'https://example.com/'.length);
    expect(padded.length).toBe(1000);
    expect(PortfolioLinkInputSchema.safeParse({ linkType: 'BLOG', url: padded }).success).toBe(true);
    expect(PortfolioLinkInputSchema.safeParse({ linkType: 'BLOG', url: padded + 'b' }).success).toBe(false);
  });

  // H005 fix 검증 — memo HTML이 sanitize('plain')으로 제거됨.
  it('memo의 HTML 태그는 sanitize로 제거됨 (저장 시점 이중 방어, H005 fix)', () => {
    const parsed = PortfolioLinkInputSchema.safeParse({
      linkType: 'BLOG',
      url: 'https://example.com',
      memo: '<script>alert(1)</script>안녕<b>강조</b>',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.memo).not.toContain('<script>');
      expect(parsed.data.memo).not.toContain('<b>');
      expect(parsed.data.memo).toContain('안녕');
    }
  });

  // H006 fix 검증 — user-info / non-standard port 차단.
  it.each([
    'https://attacker.com@github.com/ok/repo',
    'https://user:pass@github.com/repo',
    'https://github.com:8443/repo',
  ])('user-info 또는 non-standard port URL 거부: %s (H006 fix)', (badUrl) => {
    expect(PortfolioLinkInputSchema.safeParse({ linkType: 'GITHUB', url: badUrl }).success).toBe(false);
  });
});

describe('PortfolioLinksRequestSchema', () => {
  it('빈 배열 허용 (사용자가 모든 링크 삭제)', () => {
    const parsed = PortfolioLinksRequestSchema.safeParse({ links: [] });
    expect(parsed.success).toBe(true);
  });

  it('5개 정상 통과', () => {
    const links = Array.from({ length: 5 }, (_, i) => ({
      linkType: 'BLOG' as const,
      url: `https://example-${i}.com`,
    }));
    const parsed = PortfolioLinksRequestSchema.safeParse({ links });
    expect(parsed.success).toBe(true);
  });

  it('6개 초과 거부 (BR-LINK-04)', () => {
    const links = Array.from({ length: 6 }, (_, i) => ({
      linkType: 'BLOG' as const,
      url: `https://example-${i}.com`,
    }));
    const parsed = PortfolioLinksRequestSchema.safeParse({ links });
    expect(parsed.success).toBe(false);
  });

  it('하나라도 URL 위반이면 전체 거부 (atomic)', () => {
    const parsed = PortfolioLinksRequestSchema.safeParse({
      links: [
        { linkType: 'GITHUB', url: 'https://github.com/ok/repo' },
        { linkType: 'GITHUB', url: 'http://github.com/bad' },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});
