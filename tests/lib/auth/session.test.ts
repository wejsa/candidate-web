import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { RefreshToken } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { issueAccessToken, issueRefreshToken } from '@/lib/auth/jwt';
import {
  issueRefreshSession,
  revokeAllForUser,
  rotateRefreshSession,
  verifyRefreshSession,
} from '@/lib/auth/session';

// 외부 의존성(Prisma DB)만 mock — jwt.ts(jose 서명/검증)는 실제 사용.
// 실제 PrismaClient 통합 테스트는 CANDID-006-FU(별도 follow-up)로 위임 (계획서 A1).
vi.mock('@/lib/prisma', () => {
  const refreshToken = {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  };
  return {
    prisma: {
      refreshToken,
      // interactive 트랜잭션 mock — 콜백에 동일 refreshToken mock을 tx로 전달.
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({ refreshToken })),
    },
  };
});

const db = prisma as unknown as {
  refreshToken: { create: Mock; findUnique: Mock; updateMany: Mock };
  $transaction: Mock;
};

const USER_ID = 7;
const FAMILY = '22222222-2222-4222-8222-222222222222';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const sha256 = (token: string): string => createHash('sha256').update(token).digest('hex');

function fakeRow(overrides: Partial<RefreshToken> = {}): RefreshToken {
  return {
    id: 100n,
    userId: USER_ID,
    tokenHash: 'f'.repeat(64),
    familyId: FAMILY,
    rotationCounter: 0,
    expiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
    revokedAt: null,
    revokedReason: null,
    userAgent: null,
    ipAddress: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  // resetAllMocks가 지운 $transaction의 콜백 실행 구현을 매 테스트마다 복구.
  db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({ refreshToken: db.refreshToken }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('issueRefreshSession', () => {
  it('issues a refresh token and inserts a row with the sha256 hash and counter 0', async () => {
    const result = await issueRefreshSession(USER_ID);

    expect(result.token.split('.')).toHaveLength(3);
    expect(result.userId).toBe(USER_ID);
    expect(result.rotationCounter).toBe(0);
    expect(result.familyId).toMatch(UUID_RE);
    expect(db.refreshToken.create).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        tokenHash: sha256(result.token),
        familyId: result.familyId,
        rotationCounter: 0,
        expiresAt: result.expiresAt,
        userAgent: null,
        ipAddress: null,
      },
    });
  });

  it('passes rememberMe=false through to a ~1-day refresh token', async () => {
    const before = Date.now();
    const result = await issueRefreshSession(USER_ID, { rememberMe: false });
    const ttlSec = Math.round((result.expiresAt.getTime() - before) / 1000);
    expect(ttlSec).toBeGreaterThan(86_000);
    expect(ttlSec).toBeLessThanOrEqual(86_400);
  });

  it('records userAgent and ipAddress when provided', async () => {
    await issueRefreshSession(USER_ID, { userAgent: 'Mozilla/5.0', ipAddress: '203.0.113.7' });
    expect(db.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userAgent: 'Mozilla/5.0', ipAddress: '203.0.113.7' }),
    });
  });
});

describe('verifyRefreshSession', () => {
  it('verifies a live session — valid token + active row', async () => {
    const { token } = await issueRefreshToken(USER_ID);
    db.refreshToken.findUnique.mockResolvedValue(fakeRow({ tokenHash: sha256(token) }));

    const result = await verifyRefreshSession(token);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.session.userId).toBe(USER_ID);
    expect(db.refreshToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: sha256(token) },
    });
  });

  it('rejects a malformed token as invalid without querying the DB', async () => {
    expect(await verifyRefreshSession('not-a-jwt')).toEqual({ ok: false, reason: 'invalid' });
    expect(db.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an access token (wrong tokenType) without querying the DB', async () => {
    const { token } = await issueAccessToken(USER_ID);
    expect(await verifyRefreshSession(token)).toEqual({ ok: false, reason: 'invalid' });
    expect(db.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it('reports an expired token as expired without querying the DB', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T00:00:00Z'));
    const { token } = await issueRefreshToken(USER_ID, { rememberMe: false });

    vi.setSystemTime(new Date('2026-05-22T00:00:00Z'));
    expect(await verifyRefreshSession(token)).toEqual({ ok: false, reason: 'expired' });
    expect(db.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it('reports not_found when no row matches the token hash', async () => {
    const { token } = await issueRefreshToken(USER_ID);
    db.refreshToken.findUnique.mockResolvedValue(null);
    expect(await verifyRefreshSession(token)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('reports revoked when the row has revokedAt set', async () => {
    const { token } = await issueRefreshToken(USER_ID);
    db.refreshToken.findUnique.mockResolvedValue(
      fakeRow({ revokedAt: new Date(), revokedReason: 'logout' }),
    );
    expect(await verifyRefreshSession(token)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('reports expired when the DB row expiry has passed (defense-in-depth)', async () => {
    const { token } = await issueRefreshToken(USER_ID);
    db.refreshToken.findUnique.mockResolvedValue(fakeRow({ expiresAt: new Date(Date.now() - 1000) }));
    expect(await verifyRefreshSession(token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects as invalid when the row owner differs from the signed sub', async () => {
    const { token } = await issueRefreshToken(USER_ID);
    db.refreshToken.findUnique.mockResolvedValue(fakeRow({ userId: USER_ID + 999 }));
    expect(await verifyRefreshSession(token)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('rotateRefreshSession', () => {
  it('rotates — conditionally revokes the old row and creates a new one in a transaction', async () => {
    const { token: oldToken } = await issueRefreshToken(USER_ID);
    db.refreshToken.findUnique.mockResolvedValue(
      fakeRow({ id: 55n, familyId: FAMILY, rotationCounter: 2 }),
    );
    db.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    const result = await rotateRefreshSession(oldToken);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.session.familyId).toBe(FAMILY);
    expect(result.session.userId).toBe(USER_ID);
    expect(result.session.rotationCounter).toBe(3);
    expect(result.session.token).not.toBe(oldToken);

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    // 조건부 revoke — revokedAt=null인 row만 갱신 (C001 TOCTOU 차단)
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 55n, revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedReason: 'rotated' },
    });
    expect(db.refreshToken.create).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        tokenHash: sha256(result.session.token),
        familyId: FAMILY,
        rotationCounter: 3,
        expiresAt: result.session.expiresAt,
        userAgent: null,
        ipAddress: null,
      },
    });
  });

  it('aborts with revoked when a concurrent request already revoked the old row (C001)', async () => {
    const { token: oldToken } = await issueRefreshToken(USER_ID);
    db.refreshToken.findUnique.mockResolvedValue(fakeRow({ id: 55n }));
    // 조건부 updateMany가 0건 갱신 — 경쟁 요청이 먼저 회전을 완료한 상황
    db.refreshToken.updateMany.mockResolvedValue({ count: 0 });

    const result = await rotateRefreshSession(oldToken);

    expect(result).toEqual({ ok: false, reason: 'revoked' });
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });

  it('fails rotation with invalid when the old token is malformed', async () => {
    expect(await rotateRefreshSession('garbage')).toEqual({ ok: false, reason: 'invalid' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('fails rotation with revoked when the old token was already rotated', async () => {
    const { token } = await issueRefreshToken(USER_ID);
    db.refreshToken.findUnique.mockResolvedValue(fakeRow({ revokedAt: new Date() }));
    expect(await rotateRefreshSession(token)).toEqual({ ok: false, reason: 'revoked' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('revokeAllForUser', () => {
  it('revokes all active sessions for a user and returns the count', async () => {
    db.refreshToken.updateMany.mockResolvedValue({ count: 3 });

    const count = await revokeAllForUser(USER_ID, 'password_change');

    expect(count).toBe(3);
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedReason: 'password_change' },
    });
  });

  it('returns 0 when the user has no active sessions', async () => {
    db.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    expect(await revokeAllForUser(USER_ID, 'logout')).toBe(0);
  });
});
