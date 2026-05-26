// CANDID-017 Step 2 — GET / PUT /api/v1/drafts/[jobPostingId]/portfolios 통합 테스트.

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetCorsCacheForTesting } from '@/lib/security/cors';

vi.mock('@/lib/portfolios/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/portfolios/service')>(
    '@/lib/portfolios/service',
  );
  return { ...actual, listByDraft: vi.fn(), replaceForDraft: vi.fn() };
});
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

const { listByDraft, replaceForDraft } = (await import('@/lib/portfolios/service')) as unknown as {
  listByDraft: Mock;
  replaceForDraft: Mock;
};
const { requireAuth } = (await import('@/lib/auth/middleware')) as unknown as {
  requireAuth: Mock;
};
const { GET, PUT } = await import('@/app/api/v1/drafts/[jobPostingId]/portfolios/route');
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

const USER_ID = 42;
const JOB_POSTING_ID = 100;
const URL_BASE = 'https://candidate.example.com';

function getRequest(jobPostingId: string): NextRequest {
  return new NextRequest(`${URL_BASE}/api/v1/drafts/${jobPostingId}/portfolios`, {
    method: 'GET',
    headers: { 'user-agent': 'vitest' },
  });
}

function putRequest(jobPostingId: string, body: unknown): NextRequest {
  return new NextRequest(`${URL_BASE}/api/v1/drafts/${jobPostingId}/portfolios`, {
    method: 'PUT',
    headers: { 'user-agent': 'vitest', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function routeCtx(jobPostingId: string): { params: Promise<{ jobPostingId: string }> } {
  return { params: Promise.resolve({ jobPostingId }) };
}

describe('GET /api/v1/drafts/[jobPostingId]/portfolios', () => {
  it('정상: 200 + sortOrder 오름차순 응답 + Cache-Control no-store', async () => {
    requireAuth.mockResolvedValueOnce({ userId: USER_ID });
    listByDraft.mockResolvedValueOnce([
      { id: 1, linkType: 'GITHUB', url: 'https://github.com/a', memo: null, sortOrder: 0 },
      { id: 2, linkType: 'BLOG', url: 'https://blog.example.com', memo: 'm', sortOrder: 1 },
    ]);
    const res = await GET(getRequest(String(JOB_POSTING_ID)), routeCtx(String(JOB_POSTING_ID)));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as { links: { id: number; sortOrder: number }[] };
    expect(body.links).toHaveLength(2);
    expect(body.links[0]?.sortOrder).toBe(0);
    expect(listByDraft).toHaveBeenCalledWith({ userId: USER_ID, jobPostingId: JOB_POSTING_ID });
  });

  it('인증 실패: AUTH_TOKEN_INVALID → 401', async () => {
    requireAuth.mockRejectedValueOnce(new AppError('AUTH_TOKEN_INVALID'));
    const res = await GET(getRequest(String(JOB_POSTING_ID)), routeCtx(String(JOB_POSTING_ID)));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('AUTH_TOKEN_INVALID');
    expect(listByDraft).not.toHaveBeenCalled();
  });

  it('Draft 미존재: APP_DRAFT_NOT_FOUND → 404', async () => {
    requireAuth.mockResolvedValueOnce({ userId: USER_ID });
    listByDraft.mockRejectedValueOnce(new AppError('APP_DRAFT_NOT_FOUND'));
    const res = await GET(getRequest(String(JOB_POSTING_ID)), routeCtx(String(JOB_POSTING_ID)));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('APP_DRAFT_NOT_FOUND');
  });

  it('jobPostingId 형식 위반: SYS_VALIDATION_FAILED → 400', async () => {
    requireAuth.mockResolvedValueOnce({ userId: USER_ID });
    const res = await GET(getRequest('not-a-number'), routeCtx('not-a-number'));
    expect(res.status).toBe(400);
    expect(listByDraft).not.toHaveBeenCalled();
  });
});

describe('PUT /api/v1/drafts/[jobPostingId]/portfolios', () => {
  it('정상: 5개 입력 → 200 + sortOrder 0..4', async () => {
    requireAuth.mockResolvedValueOnce({ userId: USER_ID });
    const links = Array.from({ length: 5 }, (_, i) => ({
      linkType: 'BLOG' as const,
      url: `https://example-${i}.com/p`,
    }));
    replaceForDraft.mockResolvedValueOnce(
      links.map((l, i) => ({ id: 10 + i, ...l, memo: null, sortOrder: i })),
    );
    const res = await PUT(putRequest(String(JOB_POSTING_ID), { links }), routeCtx(String(JOB_POSTING_ID)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { links: { sortOrder: number }[] };
    expect(body.links).toHaveLength(5);
    expect(body.links[4]?.sortOrder).toBe(4);
    expect(replaceForDraft).toHaveBeenCalledWith({
      userId: USER_ID,
      jobPostingId: JOB_POSTING_ID,
      links: expect.arrayContaining([
        expect.objectContaining({ linkType: 'BLOG', url: 'https://example-0.com/p' }),
      ]),
    });
  });

  it('빈 배열: 200 + replace로 모두 삭제', async () => {
    requireAuth.mockResolvedValueOnce({ userId: USER_ID });
    replaceForDraft.mockResolvedValueOnce([]);
    const res = await PUT(putRequest(String(JOB_POSTING_ID), { links: [] }), routeCtx(String(JOB_POSTING_ID)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { links: unknown[] };
    expect(body.links).toEqual([]);
  });

  it('6개 입력: SYS_VALIDATION_FAILED → 400 (BR-LINK-04)', async () => {
    requireAuth.mockResolvedValueOnce({ userId: USER_ID });
    const links = Array.from({ length: 6 }, (_, i) => ({
      linkType: 'BLOG' as const,
      url: `https://example-${i}.com`,
    }));
    const res = await PUT(putRequest(String(JOB_POSTING_ID), { links }), routeCtx(String(JOB_POSTING_ID)));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
    expect(replaceForDraft).not.toHaveBeenCalled();
  });

  it('GITHUB + bitbucket URL: 화이트리스트 위반 → 400', async () => {
    requireAuth.mockResolvedValueOnce({ userId: USER_ID });
    const res = await PUT(
      putRequest(String(JOB_POSTING_ID), {
        links: [{ linkType: 'GITHUB', url: 'https://bitbucket.org/owner/repo' }],
      }),
      routeCtx(String(JOB_POSTING_ID)),
    );
    expect(res.status).toBe(400);
    expect(replaceForDraft).not.toHaveBeenCalled();
  });

  it('private IP URL: SSRF 차단 → 400', async () => {
    requireAuth.mockResolvedValueOnce({ userId: USER_ID });
    const res = await PUT(
      putRequest(String(JOB_POSTING_ID), {
        links: [{ linkType: 'BLOG', url: 'https://10.0.0.1/internal' }],
      }),
      routeCtx(String(JOB_POSTING_ID)),
    );
    expect(res.status).toBe(400);
    expect(replaceForDraft).not.toHaveBeenCalled();
  });

  it('http URL (https only): 거부 → 400', async () => {
    requireAuth.mockResolvedValueOnce({ userId: USER_ID });
    const res = await PUT(
      putRequest(String(JOB_POSTING_ID), {
        links: [{ linkType: 'BLOG', url: 'http://example.com/blog' }],
      }),
      routeCtx(String(JOB_POSTING_ID)),
    );
    expect(res.status).toBe(400);
    expect(replaceForDraft).not.toHaveBeenCalled();
  });

  it('인증 실패: AUTH_TOKEN_INVALID → 401', async () => {
    requireAuth.mockRejectedValueOnce(new AppError('AUTH_TOKEN_INVALID'));
    const res = await PUT(
      putRequest(String(JOB_POSTING_ID), { links: [] }),
      routeCtx(String(JOB_POSTING_ID)),
    );
    expect(res.status).toBe(401);
    expect(replaceForDraft).not.toHaveBeenCalled();
  });

  it('Draft 미존재 (정보 누출 차단): APP_DRAFT_NOT_FOUND → 404', async () => {
    requireAuth.mockResolvedValueOnce({ userId: USER_ID });
    replaceForDraft.mockRejectedValueOnce(new AppError('APP_DRAFT_NOT_FOUND'));
    const res = await PUT(
      putRequest(String(JOB_POSTING_ID), {
        links: [{ linkType: 'GITHUB', url: 'https://github.com/x/y' }],
      }),
      routeCtx(String(JOB_POSTING_ID)),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('APP_DRAFT_NOT_FOUND');
  });

  // H006 검증 — user-info / non-standard port URL이 Route 통합 경로에서도 거부됨.
  it.each([
    'https://attacker.com@github.com/repo',
    'https://github.com:8443/repo',
  ])('user-info/non-standard port URL: %s → 400 (H006)', async (badUrl) => {
    requireAuth.mockResolvedValueOnce({ userId: USER_ID });
    const res = await PUT(
      putRequest(String(JOB_POSTING_ID), {
        links: [{ linkType: 'GITHUB', url: badUrl }],
      }),
      routeCtx(String(JOB_POSTING_ID)),
    );
    expect(res.status).toBe(400);
    expect(replaceForDraft).not.toHaveBeenCalled();
  });
});
