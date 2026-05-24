// CANDID-014 Step 2 — lib/jobs/detail-metadata 단위 테스트.
// 순수 함수 테스트 — Prisma/Next 의존 없음.

import { describe, expect, it } from 'vitest';
import type { JobDetail } from '@/lib/jobs/types';
import { buildJobDetailMetadata, htmlToPlainText } from '@/lib/jobs/detail-metadata';

function job(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    id: 42,
    title: '백엔드 엔지니어',
    employmentType: 'FULL_TIME',
    careerLevel: 'EXPERIENCED',
    category: { name: '개발', slug: 'dev' },
    contentHtmlSanitized: '<p>본문입니다</p>',
    opensAt: new Date('2026-05-01T00:00:00Z'),
    closesAt: new Date('2026-06-01T00:00:00Z'),
    status: 'OPEN',
    isClosed: false,
    dDayLabel: 'D-8',
    questions: [],
    ...overrides,
  };
}

describe('htmlToPlainText', () => {
  it('HTML 태그 strip + 공백 정규화', () => {
    expect(htmlToPlainText('<p>안녕  <strong>세상</strong></p>')).toBe('안녕 세상');
  });

  it('빈 입력 → 빈 문자열', () => {
    expect(htmlToPlainText('')).toBe('');
  });

  it('태그만 → 빈 문자열 (공백 trim)', () => {
    expect(htmlToPlainText('<br><hr>')).toBe('');
  });

  it('maxLen 초과 → "…" 첨부', () => {
    const long = 'a'.repeat(200);
    const result = htmlToPlainText(long, 160);
    expect(result).toHaveLength(161); // 160 + '…'
    expect(result.endsWith('…')).toBe(true);
  });

  it('maxLen 이하 → 그대로 반환 (… 없음)', () => {
    const short = '짧은 본문';
    expect(htmlToPlainText(short, 160)).toBe('짧은 본문');
    expect(htmlToPlainText(short, 160).endsWith('…')).toBe(false);
  });

  it('기본 maxLen=160 (한국어 공백 없는 텍스트도 안전)', () => {
    const k = '가'.repeat(200);
    const result = htmlToPlainText(k);
    expect(result.length).toBeLessThanOrEqual(161);
  });
});

describe('buildJobDetailMetadata', () => {
  it('title은 "{공고명} | 채용 공고"', () => {
    const meta = buildJobDetailMetadata(job());
    expect(meta.title).toBe('백엔드 엔지니어 | 채용 공고');
  });

  it('description은 본문 HTML strip 후 160자 truncate', () => {
    const long = `<p>${'a'.repeat(200)}</p>`;
    const meta = buildJobDetailMetadata(job({ contentHtmlSanitized: long }));
    expect(meta.description).toMatch(/^a+…$/);
    expect(meta.description?.length).toBeLessThanOrEqual(161);
  });

  it('본문이 비어있으면 fallback description (카테고리/고용형태/경력)', () => {
    const meta = buildJobDetailMetadata(job({ contentHtmlSanitized: '' }));
    expect(meta.description).toBe('개발 / 정규직 / 경력');
  });

  it('canonical은 /jobs/{id}', () => {
    const meta = buildJobDetailMetadata(job({ id: 99 }));
    expect(meta.alternates?.canonical).toBe('/jobs/99');
  });

  it('OG type은 article + url 포함', () => {
    const meta = buildJobDetailMetadata(job({ id: 5 }));
    const og = meta.openGraph as { type?: string; url?: string };
    expect(og.type).toBe('article');
    expect(og.url).toBe('/jobs/5');
  });

  it('twitter.card === "summary" + title/description 일관성', () => {
    const meta = buildJobDetailMetadata(job());
    const tw = meta.twitter as { card?: string; title?: string; description?: string };
    expect(tw.card).toBe('summary');
    expect(tw.title).toBe(meta.title);
    expect(tw.description).toBe(meta.description);
  });

  it('마감 공고도 robots.index === true (SEO 자산 유지)', () => {
    const meta = buildJobDetailMetadata(
      job({ status: 'CLOSED', isClosed: true, dDayLabel: null }),
    );
    const robots = meta.robots as { index?: boolean; follow?: boolean };
    expect(robots.index).toBe(true);
    expect(robots.follow).toBe(true);
  });

  it('상시모집(closesAt=null)도 정상 메타 생성', () => {
    const meta = buildJobDetailMetadata(
      job({ closesAt: null, dDayLabel: '상시모집' }),
    );
    expect(meta.title).toBe('백엔드 엔지니어 | 채용 공고');
    expect(meta.description).toBe('본문입니다');
  });

  it('XSS 회귀 가드 — 이미 sanitize된 입력에 raw 태그가 남았더라도 strip', () => {
    // contentHtmlSanitized는 이미 sanitize 통과한 값이지만, description은 plain text로 다시 strip
    const meta = buildJobDetailMetadata(
      job({ contentHtmlSanitized: '<p>안녕</p><strong>세상</strong>' }),
    );
    expect(meta.description).toBe('안녕 세상');
    expect(meta.description).not.toMatch(/<[^>]+>/);
  });
});
