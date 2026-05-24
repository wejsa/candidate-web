// CANDID-015 Step 1 — GET / PUT /api/v1/drafts/[jobPostingId] route 통합 테스트.

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetCorsCacheForTesting } from '@/lib/security/cors';

vi.mock('@/lib/drafts/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/drafts/service')>(
    '@/lib/drafts/service',
  );
  return { ...actual, getOrInitDraft: vi.fn(), upsertDraft: vi.fn() };
});
vi.mock('@/lib/drafts/user-prefill', () => ({
  loadUserPrefill: vi.fn(),
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

const { getOrInitDraft, upsertDraft } = (await import('@/lib/drafts/service')) as unknown as {
  getOrInitDraft: Mock;
  upsertDraft: Mock;
};
const { loadUserPrefill } = (await import('@/lib/drafts/user-prefill')) as unknown as {
  loadUserPrefill: Mock;
};
const { requireAuth } = (await import('@/lib/auth/middleware')) as unknown as {
  requireAuth: Mock;
};
const { GET, PUT, runtime } = await import('@/app/api/v1/drafts/[jobPostingId]/route');
const { AppError } = await import('@/lib/errors');
const { initialPayload } = await import('@/lib/drafts/schema');

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

function getRequest(jobPostingId: string): NextRequest {
  return new NextRequest(
    `https://candidate.example.com/api/v1/drafts/${jobPostingId}`,
    { method: 'GET', headers: { 'user-agent': 'vitest' } },
  );
}

function putRequest(jobPostingId: string, body: unknown): NextRequest {
  return new NextRequest(
    `https://candidate.example.com/api/v1/drafts/${jobPostingId}`,
    {
      method: 'PUT',
      headers: { 'user-agent': 'vitest', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

describe('runtime', () => {
  it('export const runtime === "nodejs"', () => {
    expect(runtime).toBe('nodejs');
  });
});

describe('GET /api/v1/drafts/[jobPostingId]', () => {
  it('200 + payload + version + lastSavedAt + prefill (Step 2 User PII 복호화)', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 100 });
    getOrInitDraft.mockResolvedValueOnce({
      draft: {
        id: 1,
        payloadJson: initialPayload(),
        version: 1,
        lastSavedAt: new Date('2026-05-24T00:00:00Z'),
      },
      created: true,
    });
    loadUserPrefill.mockResolvedValueOnce({
      email: 'alice@example.com',
      name: '홍길동',
      phone: '010-1234-5678',
      birthDate: '1995-03-15',
    });
    const res = await GET(getRequest('42'), { params: { jobPostingId: '42' } });
    expect(res.status).toBe(200);
    // SECURITY (S-MAJOR-2): Cache-Control private, no-store 부착
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await res.json();
    expect(body.version).toBe(1);
    expect(body.payload).toEqual(initialPayload());
    expect(body.lastSavedAt).toBe('2026-05-24T00:00:00.000Z');
    expect(body.prefill).toEqual({
      email: 'alice@example.com',
      name: '홍길동',
      phone: '010-1234-5678',
      birthDate: '1995-03-15',
    });
    expect(getOrInitDraft).toHaveBeenCalledWith(100, 42);
    expect(loadUserPrefill).toHaveBeenCalledWith(100);
  });

  it('User PII null (소셜) → prefill에 null 반환', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 200 });
    getOrInitDraft.mockResolvedValueOnce({
      draft: {
        id: 2,
        payloadJson: initialPayload(),
        version: 1,
        lastSavedAt: new Date('2026-05-24T00:00:00Z'),
      },
      created: false,
    });
    loadUserPrefill.mockResolvedValueOnce({
      email: 'social@example.com',
      name: '김소셜',
      phone: null,
      birthDate: null,
    });
    const res = await GET(getRequest('1'), { params: { jobPostingId: '1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prefill.phone).toBeNull();
    expect(body.prefill.birthDate).toBeNull();
  });

  it('401 → AUTH_TOKEN_INVALID', async () => {
    requireAuth.mockRejectedValueOnce(new AppError('AUTH_TOKEN_INVALID'));
    const res = await GET(getRequest('1'), { params: { jobPostingId: '1' } });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('AUTH_TOKEN_INVALID');
    expect(getOrInitDraft).not.toHaveBeenCalled();
  });

  it('404 → JOB_NOT_FOUND', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 100 });
    getOrInitDraft.mockRejectedValueOnce(new AppError('JOB_NOT_FOUND'));
    const res = await GET(getRequest('999'), { params: { jobPostingId: '999' } });
    expect(res.status).toBe(404);
  });

  it('422 → JOB_CLOSED', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 100 });
    getOrInitDraft.mockRejectedValueOnce(new AppError('JOB_CLOSED'));
    const res = await GET(getRequest('1'), { params: { jobPostingId: '1' } });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('JOB_CLOSED');
  });

  it('400 → jobPostingId NaN', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 100 });
    const res = await GET(getRequest('abc'), { params: { jobPostingId: 'abc' } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
    expect(getOrInitDraft).not.toHaveBeenCalled();
  });

  it('Next.js 15 Promise params 호환', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 100 });
    getOrInitDraft.mockResolvedValueOnce({
      draft: {
        id: 1,
        payloadJson: initialPayload(),
        version: 1,
        lastSavedAt: new Date('2026-05-24T00:00:00Z'),
      },
      created: true,
    });
    const res = await GET(getRequest('42'), {
      params: Promise.resolve({ jobPostingId: '42' }),
    });
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/v1/drafts/[jobPostingId]', () => {
  it('200 → upsertDraft 호출 + version+1 + lastSavedAt 반환', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 100 });
    upsertDraft.mockResolvedValueOnce({
      version: 6,
      lastSavedAt: new Date('2026-05-24T00:00:01Z'),
    });
    const res = await PUT(
      putRequest('42', { payload: initialPayload(), version: 5 }),
      { params: { jobPostingId: '42' } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(6);
    expect(body.lastSavedAt).toBe('2026-05-24T00:00:01.000Z');
    expect(upsertDraft).toHaveBeenCalledWith({
      userId: 100,
      jobPostingId: 42,
      payload: initialPayload(),
      expectedVersion: 5,
    });
  });

  it('400 → body schema 실패 (version 누락)', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 100 });
    const res = await PUT(
      putRequest('1', { payload: initialPayload() }),
      { params: { jobPostingId: '1' } },
    );
    expect(res.status).toBe(400);
    expect(upsertDraft).not.toHaveBeenCalled();
  });

  it('400 → payload 안 만 14세 미만 (PersonalInfoSchema)', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 100 });
    const badPayload = {
      schemaVersion: 1,
      meta: { currentStep: 1, completedSteps: [] },
      step1_personal: {
        name: '홍길동',
        phone: '010-1234-5678',
        birthDate: '2020-01-01',
        careerLevel: 'NEW',
      },
    };
    const res = await PUT(
      putRequest('1', { payload: badPayload, version: 1 }),
      { params: { jobPostingId: '1' } },
    );
    expect(res.status).toBe(400);
    expect(upsertDraft).not.toHaveBeenCalled();
  });

  it('409 → APP_DRAFT_CONFLICT', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 100 });
    upsertDraft.mockRejectedValueOnce(new AppError('APP_DRAFT_CONFLICT'));
    const res = await PUT(
      putRequest('1', { payload: initialPayload(), version: 5 }),
      { params: { jobPostingId: '1' } },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('APP_DRAFT_CONFLICT');
  });

  it('422 → JOB_CLOSED', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 100 });
    upsertDraft.mockRejectedValueOnce(new AppError('JOB_CLOSED'));
    const res = await PUT(
      putRequest('1', { payload: initialPayload(), version: 0 }),
      { params: { jobPostingId: '1' } },
    );
    expect(res.status).toBe(422);
  });

  it('401 → 인증 실패는 upsert 호출 없음', async () => {
    requireAuth.mockRejectedValueOnce(new AppError('AUTH_TOKEN_EXPIRED'));
    const res = await PUT(
      putRequest('1', { payload: initialPayload(), version: 0 }),
      { params: { jobPostingId: '1' } },
    );
    expect(res.status).toBe(401);
    expect(upsertDraft).not.toHaveBeenCalled();
  });
});
