// CANDID-013 Step 3 — lib/jobs/filter-changes 단위 테스트.

import { describe, expect, it } from 'vitest';
import { JobListQuerySchema } from '@/lib/jobs/list';
import { applyFilterChange, buildResetUrl } from '@/lib/jobs/filter-changes';

function q(overrides: Record<string, unknown> = {}) {
  return JobListQuerySchema.parse(overrides);
}

describe('applyFilterChange', () => {
  it('필터 변경 시 page=1로 리셋 (page=5에서 employment 변경)', () => {
    expect(
      applyFilterChange({
        basePath: '/jobs',
        query: q({ page: '5', category: 'dev' }),
        field: 'employment',
        value: 'CONTRACT',
      }),
    ).toBe('/jobs?category=dev&employment=CONTRACT');
  });

  it('value="" → 해당 필터 해제 (employment 해제)', () => {
    expect(
      applyFilterChange({
        basePath: '/jobs',
        query: q({ employment: 'FULL_TIME', career: 'NEW' }),
        field: 'employment',
        value: '',
      }),
    ).toBe('/jobs?career=NEW');
  });

  it('value=null → 해당 필터 해제', () => {
    expect(
      applyFilterChange({
        basePath: '/jobs',
        query: q({ category: 'dev' }),
        field: 'category',
        value: null,
      }),
    ).toBe('/jobs');
  });

  it('sort 빈 값 → latest 폴백 (default)', () => {
    expect(
      applyFilterChange({
        basePath: '/jobs',
        query: q({ sort: 'deadline' }),
        field: 'sort',
        value: '',
      }),
    ).toBe('/jobs'); // sort=latest는 URL에서 생략
  });

  it('includeClosed 빈 값 → true 폴백', () => {
    expect(
      applyFilterChange({
        basePath: '/jobs',
        query: q({ includeClosed: 'false' }),
        field: 'includeClosed',
        value: '',
      }),
    ).toBe('/jobs'); // includeClosed=true는 URL에서 생략
  });

  it('includeClosed boolean true → URL에서 생략', () => {
    expect(
      applyFilterChange({
        basePath: '/jobs',
        query: q({ includeClosed: 'false' }),
        field: 'includeClosed',
        value: true,
      }),
    ).toBe('/jobs');
  });

  it('includeClosed boolean false → ?includeClosed=false', () => {
    expect(
      applyFilterChange({
        basePath: '/jobs',
        query: q(),
        field: 'includeClosed',
        value: false,
      }),
    ).toBe('/jobs?includeClosed=false');
  });

  it('category 설정 + 다른 필터 보존', () => {
    expect(
      applyFilterChange({
        basePath: '/jobs',
        query: q({ employment: 'INTERN', sort: 'deadline' }),
        field: 'category',
        value: 'design',
      }),
    ).toBe('/jobs?category=design&employment=INTERN&sort=deadline');
  });

  it('sort 변경 → 다른 필터 보존 + page=1', () => {
    expect(
      applyFilterChange({
        basePath: '/jobs',
        query: q({ category: 'dev', page: '3' }),
        field: 'sort',
        value: 'deadline',
      }),
    ).toBe('/jobs?category=dev&sort=deadline');
  });

  it('basePath 커스터마이즈 지원', () => {
    expect(
      applyFilterChange({
        basePath: '/careers',
        query: q(),
        field: 'category',
        value: 'dev',
      }),
    ).toBe('/careers?category=dev');
  });
});

describe('buildResetUrl', () => {
  it('basePath만 반환 (모든 필터 해제)', () => {
    expect(buildResetUrl('/jobs')).toBe('/jobs');
    expect(buildResetUrl('/careers')).toBe('/careers');
  });
});
