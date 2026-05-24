// CANDID-014 Step 1 — GET /api/v1/job-postings/[id] route 통합 테스트.
// lib/jobs/detail의 getJobDetail은 mock — route 자체의 zod parse + 응답 status/body만 검증.

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetCorsCacheForTesting } from '@/lib/security/cors';

vi.mock('@/lib/jobs/detail', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jobs/detail')>('@/lib/jobs/detail');
  return {
    ...actual,
    getJobDetail: vi.fn(),
  };
});

const { getJobDetail } = (await import('@/lib/jobs/detail')) as unknown as {
  getJobDetail: Mock;
};
const route = await import('@/app/api/v1/job-postings/[id]/route');
const { GET } = route;
const { AppError } = await import('@/lib/errors');

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

function getRequest(id: string): NextRequest {
  return new NextRequest(`https://candidate.example.com/api/v1/job-postings/${id}`, {
    method: 'GET',
    headers: { 'user-agent': 'vitest' },
  });
}

const okDetail = {
  id: 1,
  title: '백엔드 엔지니어',
  employmentType: 'FULL_TIME',
  careerLevel: 'EXPERIENCED',
  category: { name: '개발', slug: 'dev' },
  contentHtmlSanitized: '<p>본문</p>',
  opensAt: new Date('2026-05-01T00:00:00Z'),
  closesAt: new Date('2026-06-01T00:00:00Z'),
  status: 'OPEN',
  isClosed: false,
  dDayLabel: 'D-8',
  questions: [],
};

describe('GET /api/v1/job-postings/[id] — 정상', () => {
  it('200 + JobDetail 필드 (id + status + isClosed 포함)', async () => {
    getJobDetail.mockResolvedValueOnce(okDetail);
    const res = await GET(getRequest('1'), { params: { id: '1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(1);
    expect(body.title).toBe('백엔드 엔지니어');
    expect(body.status).toBe('OPEN');
    expect(body.isClosed).toBe(false);
    expect(body.dDayLabel).toBe('D-8');
    expect(body.category).toEqual({ name: '개발', slug: 'dev' });
    expect(body.contentHtmlSanitized).toBe('<p>본문</p>');
    // getJobDetail 호출 인자는 number로 coerce됨
    expect(getJobDetail).toHaveBeenCalledWith(1);
  });

  it('Next.js 15 Promise params 호환', async () => {
    getJobDetail.mockResolvedValueOnce(okDetail);
    const res = await GET(getRequest('1'), { params: Promise.resolve({ id: '1' }) });
    expect(res.status).toBe(200);
    expect(getJobDetail).toHaveBeenCalledWith(1);
  });
});

describe('GET /api/v1/job-postings/[id] — 검증 실패', () => {
  it('id가 정수 아님 → 400 SYS_VALIDATION_FAILED', async () => {
    const res = await GET(getRequest('not-a-number'), { params: { id: 'not-a-number' } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
    expect(getJobDetail).not.toHaveBeenCalled();
  });

  it('id가 음수/0 → 400', async () => {
    const res = await GET(getRequest('0'), { params: { id: '0' } });
    expect(res.status).toBe(400);
    expect(getJobDetail).not.toHaveBeenCalled();
  });

  it('id가 소수 → 400 (int 검증)', async () => {
    const res = await GET(getRequest('1.5'), { params: { id: '1.5' } });
    expect(res.status).toBe(400);
    expect(getJobDetail).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/job-postings/[id] — 404 분기', () => {
  it('존재하지 않음 → 404 JOB_NOT_FOUND', async () => {
    getJobDetail.mockRejectedValueOnce(new AppError('JOB_NOT_FOUND'));
    const res = await GET(getRequest('999'), { params: { id: '999' } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('JOB_NOT_FOUND');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('traceId');
  });

  it('DRAFT 비공개도 동일하게 404 (정보 노출 방지)', async () => {
    getJobDetail.mockRejectedValueOnce(new AppError('JOB_NOT_FOUND'));
    const res = await GET(getRequest('2'), { params: { id: '2' } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('JOB_NOT_FOUND');
  });
});

describe('GET /api/v1/job-postings/[id] — 500 분기', () => {
  it('예상치 못한 throw → 500 SYS_INTERNAL_ERROR', async () => {
    getJobDetail.mockRejectedValueOnce(new Error('boom'));
    const res = await GET(getRequest('1'), { params: { id: '1' } });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('SYS_INTERNAL_ERROR');
  });
});

describe('runtime 명시', () => {
  it('export const runtime === "nodejs" (isomorphic-dompurify Edge 미지원)', () => {
    expect(route.runtime).toBe('nodejs');
  });
});
