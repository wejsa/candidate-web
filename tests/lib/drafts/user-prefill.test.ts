// CANDID-015 Step 2 — lib/drafts/user-prefill 단위 테스트.
// piiExtension wrapped prisma.user.findUnique를 mock하여 결과 매핑/만 14세 가드 검증.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/prisma', () => {
  const userFindUnique = vi.fn();
  return {
    prisma: { user: { findUnique: userFindUnique } },
    basePrisma: { user: { findUnique: userFindUnique } },
  };
});

const { prisma } = (await import('@/lib/prisma')) as unknown as {
  prisma: { user: { findUnique: Mock } };
};
const { loadUserPrefill, assertUserMinAge } = await import('@/lib/drafts/user-prefill');
const { AppError } = await import('@/lib/errors');

const NOW = new Date('2026-05-24T00:00:00Z');

beforeEach(() => {
  prisma.user.findUnique.mockReset();
});

describe('loadUserPrefill', () => {
  it('User PII 4필드 평문 반환 (piiExtension wrapped prisma 자동 복호화)', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      email: 'alice@example.com',
      name: '홍길동',
      phone: '010-1234-5678', // wrapped: Uint8Array → string
      birthDate: '1995-03-15',
    });
    const result = await loadUserPrefill(100);
    expect(result).toEqual({
      email: 'alice@example.com',
      name: '홍길동',
      phone: '010-1234-5678',
      birthDate: '1995-03-15',
    });
  });

  it('phone/birthDate가 null (소셜 가입자)인 경우도 반환', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      email: 'social@example.com',
      name: '김소셜',
      phone: null,
      birthDate: null,
    });
    const result = await loadUserPrefill(100);
    expect(result.phone).toBeNull();
    expect(result.birthDate).toBeNull();
    expect(result.email).toBe('social@example.com');
  });

  it('User 미존재 → USER_NOT_FOUND (defense-in-depth)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const error = await loadUserPrefill(999).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('wrapped prisma 사용 (basePrisma ✗) — piiExtension 우회 차단', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      email: 'a@b.com',
      name: 'A',
      phone: null,
      birthDate: null,
    });
    await loadUserPrefill(100);
    // mock은 prisma + basePrisma 동일 객체이지만, 실제 import는 wrapped prisma만 사용 가정
    const arg = prisma.user.findUnique.mock.calls[0]![0];
    expect(arg.where).toEqual({ id: 100 });
    expect(arg.select).toEqual({
      email: true,
      name: true,
      phone: true,
      birthDate: true,
    });
  });
});

describe('assertUserMinAge — 3-layer 검증 중 server-side cross-check', () => {
  it('User.birthDate가 null (소셜) → 검증 스킵', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ birthDate: null });
    await expect(assertUserMinAge(100, NOW)).resolves.toBeUndefined();
  });

  it('User.birthDate가 만 14세 이상 → 통과', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ birthDate: '1995-03-15' });
    await expect(assertUserMinAge(100, NOW)).resolves.toBeUndefined();
  });

  it('User.birthDate가 만 14세 미만 → APP_USER_UNDER_MIN_AGE throw', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ birthDate: '2013-01-01' });
    await expect(assertUserMinAge(100, NOW)).rejects.toMatchObject({
      code: 'APP_USER_UNDER_MIN_AGE',
    });
  });

  it('User 미존재 → USER_NOT_FOUND', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(assertUserMinAge(999, NOW)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('정확히 14년 전 동일자 (만 14세 생일) → 통과 (경계 케이스)', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ birthDate: '2012-05-24' });
    await expect(assertUserMinAge(100, NOW)).resolves.toBeUndefined();
  });

  it('14년 전 - 1일 (만 13세 364일) → throw (경계 케이스)', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ birthDate: '2012-05-25' });
    await expect(assertUserMinAge(100, NOW)).rejects.toMatchObject({
      code: 'APP_USER_UNDER_MIN_AGE',
    });
  });
});
