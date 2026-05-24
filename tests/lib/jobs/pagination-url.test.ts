// CANDID-013 Step 2 — lib/jobs/pagination-url 단위 테스트.

import { describe, expect, it } from 'vitest';
import { JobListQuerySchema } from '@/lib/jobs/list';
import { buildPageUrl, getPageWindow } from '@/lib/jobs/pagination-url';

function q(overrides: Record<string, unknown> = {}) {
  return JobListQuerySchema.parse(overrides);
}

describe('buildPageUrl', () => {
  it('기본값 + page=1 → basePath만', () => {
    expect(buildPageUrl({ basePath: '/jobs', query: q(), page: 1 })).toBe('/jobs');
  });

  it('page=5 → ?page=5', () => {
    expect(buildPageUrl({ basePath: '/jobs', query: q(), page: 5 })).toBe('/jobs?page=5');
  });

  it('필터 보존 + 새 page 적용', () => {
    expect(
      buildPageUrl({
        basePath: '/jobs',
        query: q({ category: 'dev', sort: 'deadline' }),
        page: 3,
      }),
    ).toBe('/jobs?category=dev&sort=deadline&page=3');
  });

  it('includeClosed=false 보존', () => {
    expect(
      buildPageUrl({ basePath: '/jobs', query: q({ includeClosed: 'false' }), page: 2 }),
    ).toBe('/jobs?includeClosed=false&page=2');
  });

  it('basePath 변경 지원', () => {
    expect(buildPageUrl({ basePath: '/careers', query: q(), page: 2 })).toBe('/careers?page=2');
  });

  it('PR #48 review T-fix: 같은 page 재호출 idempotent', () => {
    const query = q({ category: 'dev', page: '3' });
    const a = buildPageUrl({ basePath: '/jobs', query, page: 3 });
    const b = buildPageUrl({ basePath: '/jobs', query, page: 3 });
    expect(a).toBe(b);
    expect(a).toBe('/jobs?category=dev&page=3');
  });

  it('PR #48 review T-fix: page=0/음수 → basePath만 (page>1 가드)', () => {
    expect(buildPageUrl({ basePath: '/jobs', query: q(), page: 0 })).toBe('/jobs');
    expect(buildPageUrl({ basePath: '/jobs', query: q(), page: -5 })).toBe('/jobs');
  });
});

describe('getPageWindow', () => {
  it('totalPages=0 → []', () => {
    expect(getPageWindow(1, 0, 2)).toEqual([]);
  });

  it('totalPages=1 → [1]', () => {
    expect(getPageWindow(1, 1, 2)).toEqual([1]);
  });

  it('current=5, total=20, window=2 → [3,4,5,6,7]', () => {
    expect(getPageWindow(5, 20, 2)).toEqual([3, 4, 5, 6, 7]);
  });

  it('왼쪽 경계 클램프: current=1, total=20 → [1,2,3]', () => {
    expect(getPageWindow(1, 20, 2)).toEqual([1, 2, 3]);
  });

  it('오른쪽 경계 클램프: current=20, total=20 → [18,19,20]', () => {
    expect(getPageWindow(20, 20, 2)).toEqual([18, 19, 20]);
  });

  it('current이 totalPages 초과 → 마지막에 클램프', () => {
    expect(getPageWindow(99, 5, 2)).toEqual([3, 4, 5]);
  });

  it('current=0 (음수 방어) → 1로 클램프', () => {
    expect(getPageWindow(0, 5, 2)).toEqual([1, 2, 3]);
  });

  it('window=0 → current만', () => {
    expect(getPageWindow(5, 10, 0)).toEqual([5]);
  });
});
