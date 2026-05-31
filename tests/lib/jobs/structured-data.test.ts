import { describe, expect, it } from 'vitest';
import type { JobDetail } from '@/lib/jobs/types';
import { buildJobPostingJsonLd, jsonLdScriptContent } from '@/lib/jobs/structured-data';

const BASE = 'https://careers.example.com';

function fakeJob(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    id: 42,
    title: '시니어 백엔드 엔지니어',
    employmentType: 'FULL_TIME',
    careerLevel: 'EXPERIENCED',
    category: { name: '개발', slug: 'engineering' },
    contentHtmlSanitized: '<p>Node.js/TypeScript 백엔드 개발자를 모십니다.</p>',
    opensAt: new Date('2026-05-01T00:00:00.000Z'),
    closesAt: new Date('2026-06-30T15:00:00.000Z'),
    status: 'OPEN',
    isClosed: false,
    dDayLabel: 'D-30',
    questions: [],
    ...overrides,
  };
}

describe('buildJobPostingJsonLd', () => {
  it('maps a JobDetail to a complete schema.org JobPosting with validThrough when closesAt is set', () => {
    const ld = buildJobPostingJsonLd(fakeJob(), BASE);

    expect(ld).toMatchObject({
      '@context': 'https://schema.org/',
      '@type': 'JobPosting',
      'title': '시니어 백엔드 엔지니어',
      'datePosted': '2026-05-01T00:00:00.000Z',
      'validThrough': '2026-06-30T15:00:00.000Z',
      'employmentType': 'FULL_TIME',
      'jobLocationType': 'TELECOMMUTE',
      'applicantLocationRequirements': { '@type': 'Country', 'name': 'KR' },
      'url': 'https://careers.example.com/jobs/42',
      'directApply': true,
    });
    expect(ld.hiringOrganization).toMatchObject({ '@type': 'Organization', 'sameAs': BASE });
    expect(ld.description).toContain('Node.js');
    // HTML 태그는 description에서 strip 되어야 한다.
    expect(ld.description).not.toContain('<p>');
  });

  it('omits validThrough for 상시모집 (closesAt = null)', () => {
    const ld = buildJobPostingJsonLd(fakeJob({ closesAt: null }), BASE);
    expect(ld.validThrough).toBeUndefined();
    expect('validThrough' in ld).toBe(false);
  });

  it('maps Prisma employmentType to the schema.org enum (CONTRACT→CONTRACTOR, INTERN→INTERN)', () => {
    expect(
      buildJobPostingJsonLd(fakeJob({ employmentType: 'CONTRACT' }), BASE).employmentType,
    ).toBe('CONTRACTOR');
    expect(buildJobPostingJsonLd(fakeJob({ employmentType: 'INTERN' }), BASE).employmentType).toBe(
      'INTERN',
    );
  });

  it('normalizes a trailing slash in baseUrl when composing url/sameAs', () => {
    const ld = buildJobPostingJsonLd(fakeJob(), `${BASE}/`);
    expect(ld.url).toBe('https://careers.example.com/jobs/42');
    expect(ld.hiringOrganization).toMatchObject({ sameAs: BASE });
  });

  it('falls back to the title for description when sanitized content is empty', () => {
    const ld = buildJobPostingJsonLd(fakeJob({ contentHtmlSanitized: '' }), BASE);
    expect(ld.description).toBe('시니어 백엔드 엔지니어');
  });

  it('keeps closed jobs as SEO assets — past validThrough is still emitted (BR-JOB-02)', () => {
    const ld = buildJobPostingJsonLd(
      fakeJob({ isClosed: true, status: 'CLOSED', closesAt: new Date('2020-01-01T00:00:00.000Z') }),
      BASE,
    );
    expect(ld.validThrough).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('jsonLdScriptContent', () => {
  it('escapes "<" to \\u003c to prevent </script> breakout (XSS)', () => {
    const malicious = buildJobPostingJsonLd(
      fakeJob({ title: 'XSS</script><script>alert(1)</script>' }),
      BASE,
    );
    const out = jsonLdScriptContent(malicious);

    // 원문 '<'가 출력에 남으면 안 된다 — 모두 <로 치환.
    expect(out).not.toContain('<');
    expect(out).toContain('\\u003c');
    // 직렬화는 여전히 유효한 JSON이며 round-trip 시 원래 title이 복원된다.
    const parsed = JSON.parse(out);
    expect(parsed.title).toBe('XSS</script><script>alert(1)</script>');
  });

  it('produces parseable JSON for a normal job', () => {
    const out = jsonLdScriptContent(buildJobPostingJsonLd(fakeJob(), BASE));
    expect(() => JSON.parse(out)).not.toThrow();
    expect(JSON.parse(out)['@type']).toBe('JobPosting');
  });
});
