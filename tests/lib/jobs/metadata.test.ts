// CANDID-013 Step 2 — lib/jobs/metadata 단위 테스트.
// generateMetadata 분리 함수의 title/description/canonical 정확성.

import { describe, expect, it } from 'vitest';
import { JobListQuerySchema } from '@/lib/jobs/list';
import { buildCanonicalPath, buildJobsListMetadata } from '@/lib/jobs/metadata';

function q(overrides: Record<string, unknown> = {}) {
  return JobListQuerySchema.parse(overrides);
}

describe('buildJobsListMetadata', () => {
  it('빈 필터 + total=0 → 기본 title/description', () => {
    const m = buildJobsListMetadata({ query: q(), total: 0 });
    expect(m.title).toBe('채용 공고');
    expect(m.description).toMatch(/전체.*채용 공고 목록.*최신순/);
  });

  it('total > 0 → 건수 포함', () => {
    const m = buildJobsListMetadata({ query: q(), total: 1234 });
    expect(m.description).toContain('1,234건');
  });

  it('필터 + sort=deadline → title에 라벨 결합 + description 마감임박순', () => {
    const m = buildJobsListMetadata({
      query: q({ category: 'dev', employment: 'CONTRACT', career: 'NEW', sort: 'deadline' }),
      total: 12,
      categoryName: '개발',
    });
    expect(m.title).toBe('개발 / 계약직 / 신입 채용 공고');
    expect(m.description).toContain('개발 · 계약직 · 신입');
    expect(m.description).toContain('12건');
    expect(m.description).toContain('마감임박순');
  });

  it('categoryName 미제공 시 slug 그대로 사용', () => {
    const m = buildJobsListMetadata({ query: q({ category: 'design' }), total: 0 });
    expect(m.title).toContain('design');
  });

  it('OG/Twitter 메타 필드 채워짐 + robots=index/follow', () => {
    const m = buildJobsListMetadata({ query: q(), total: 0 });
    expect(m.openGraph).toMatchObject({ type: 'website' });
    expect(m.openGraph?.title).toBe('채용 공고');
    expect(m.twitter).toMatchObject({ card: 'summary' });
    expect(m.robots).toMatchObject({ index: true, follow: true });
  });

  it('canonical 포함', () => {
    const m = buildJobsListMetadata({ query: q({ category: 'dev', page: '2' }), total: 0 });
    expect(m.alternates?.canonical).toBe('/jobs?category=dev&page=2');
  });

  it('EmploymentType/CareerLevel 모든 enum 라벨 매핑', () => {
    expect(
      buildJobsListMetadata({ query: q({ employment: 'FULL_TIME' }), total: 0 }).title,
    ).toContain('정규직');
    expect(
      buildJobsListMetadata({ query: q({ employment: 'INTERN' }), total: 0 }).title,
    ).toContain('인턴');
    expect(buildJobsListMetadata({ query: q({ career: 'EXPERIENCED' }), total: 0 }).title).toContain(
      '경력',
    );
    expect(buildJobsListMetadata({ query: q({ career: 'ANY' }), total: 0 }).title).toContain('무관');
  });
});

describe('buildCanonicalPath', () => {
  it('기본값(latest/page=1/includeClosed=true) → /jobs (생략)', () => {
    expect(buildCanonicalPath(q())).toBe('/jobs');
  });

  it('category만 → /jobs?category=dev', () => {
    expect(buildCanonicalPath(q({ category: 'dev' }))).toBe('/jobs?category=dev');
  });

  it('sort=deadline → 쿼리에 포함 (sort=latest는 제외 → 정규형)', () => {
    expect(buildCanonicalPath(q({ sort: 'deadline' }))).toBe('/jobs?sort=deadline');
  });

  it('page > 1 → 포함', () => {
    expect(buildCanonicalPath(q({ page: '3' }))).toBe('/jobs?page=3');
  });

  it('includeClosed=false → 포함 (true는 생략)', () => {
    expect(buildCanonicalPath(q({ includeClosed: 'false' }))).toBe('/jobs?includeClosed=false');
  });

  it('전체 조합 — URL 빌더 순서 안정성 (회귀 보호)', () => {
    expect(
      buildCanonicalPath(
        q({
          category: 'dev',
          employment: 'CONTRACT',
          career: 'NEW',
          sort: 'deadline',
          includeClosed: 'false',
          page: '4',
        }),
      ),
    ).toBe(
      '/jobs?category=dev&employment=CONTRACT&career=NEW&sort=deadline&includeClosed=false&page=4',
    );
  });
});
