// CANDID-013 Step 1 — GET /api/v1/jobs route 통합 테스트.
// lib/jobs/list의 listJobs는 mock — route 자체의 zod parse + 응답 status/body만 검증.

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetCorsCacheForTesting } from '@/lib/security/cors';

vi.mock('@/lib/jobs/list', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jobs/list')>('@/lib/jobs/list');
  return {
    ...actual,
    listJobs: vi.fn(),
  };
});

const { listJobs } = (await import('@/lib/jobs/list')) as unknown as { listJobs: Mock };
const { GET } = await import('@/app/api/v1/jobs/route');

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://candidate.example.com');
  __resetCachedEnvForTesting();
  __resetCorsCacheForTesting();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetCachedEnvForTesting();
  __resetCorsCacheForTesting();
});

function getRequest(qs = ''): NextRequest {
  const url = `https://candidate.example.com/api/v1/jobs${qs ? `?${qs}` : ''}`;
  return new NextRequest(url, {
    method: 'GET',
    headers: { 'user-agent': 'vitest' },
  });
}

const okResponse = {
  items: [
    {
      id: 1,
      title: '백엔드 엔지니어',
      employmentType: 'FULL_TIME',
      careerLevel: 'EXPERIENCED',
      category: { name: '개발', slug: 'dev' },
      opensAt: new Date('2026-05-01T00:00:00Z'),
      closesAt: new Date('2026-06-01T00:00:00Z'),
      dDayLabel: 'D-8',
    },
  ],
  pagination: { page: 1, perPage: 20, total: 1, totalPages: 1, hasMore: false },
};

describe('GET /api/v1/jobs — 정상', () => {
  it('200 + items + pagination', async () => {
    listJobs.mockResolvedValueOnce(okResponse);
    const res = await GET(getRequest('sort=latest'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.pagination).toMatchObject({ page: 1, perPage: 20, total: 1 });
    // listJobs 인자: parse된 query
    const arg = listJobs.mock.calls[0]![0];
    expect(arg).toMatchObject({ sort: 'latest', page: 1, includeClosed: true });
  });

  it('필터/페이지 파싱', async () => {
    listJobs.mockResolvedValueOnce({
      items: [],
      pagination: { page: 2, perPage: 20, total: 0, totalPages: 1, hasMore: false },
    });
    const res = await GET(
      getRequest('category=dev&employment=CONTRACT&career=NEW&sort=deadline&page=2'),
      undefined,
    );
    expect(res.status).toBe(200);
    const arg = listJobs.mock.calls[0]![0];
    expect(arg).toMatchObject({
      category: 'dev',
      employment: 'CONTRACT',
      career: 'NEW',
      sort: 'deadline',
      page: 2,
    });
  });

  it('includeClosed=false 파싱', async () => {
    listJobs.mockResolvedValueOnce(okResponse);
    await GET(getRequest('includeClosed=false'), undefined);
    const arg = listJobs.mock.calls[0]![0];
    expect(arg.includeClosed).toBe(false);
  });
});

describe('GET /api/v1/jobs — 검증 실패', () => {
  it('잘못된 employment enum → 422 SYS_VALIDATION_FAILED', async () => {
    const res = await GET(getRequest('employment=PART_TIME'), undefined);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
    expect(listJobs).not.toHaveBeenCalled();
  });

  it('page=0 → 400', async () => {
    const res = await GET(getRequest('page=0'), undefined);
    expect(res.status).toBe(400);
    expect(listJobs).not.toHaveBeenCalled();
  });

  it('page=51 (MAX_PAGE 초과) → 400', async () => {
    const res = await GET(getRequest('page=51'), undefined);
    expect(res.status).toBe(400);
    expect(listJobs).not.toHaveBeenCalled();
  });

  it('잘못된 sort → 400', async () => {
    const res = await GET(getRequest('sort=popular'), undefined);
    expect(res.status).toBe(400);
    expect(listJobs).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/jobs — 서버 오류', () => {
  it('listJobs throw → 500 SYS_INTERNAL_ERROR', async () => {
    listJobs.mockRejectedValueOnce(new Error('boom'));
    const res = await GET(getRequest(), undefined);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('SYS_INTERNAL_ERROR');
  });
});
