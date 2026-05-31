// CANDID-024 Step 1 — lib/users/profile-service.getProfile 단위 테스트.
// prisma는 mock. piiExtension 복호화는 mock row에서 평문 string으로 직접 제공한다.
// (실제 암호문→평문 복호화 경로는 tests/integration/prisma-extends-user-roundtrip.test.ts +
//  tests/lib/prisma/extends.test.ts에서 검증됨 — 본 테스트는 그 위임을 신뢰하고 DTO 매핑만 단위 검증.)

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/prisma', () => {
  const findUnique = vi.fn();
  return {
    prisma: { user: { findUnique } },
    basePrisma: { user: { findUnique } },
  };
});

const { prisma } = (await import('@/lib/prisma')) as unknown as {
  prisma: { user: { findUnique: Mock } };
};
const { getProfile } = await import('@/lib/users/profile-service');
const { AppError } = await import('@/lib/errors');

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    email: 'kim@example.com',
    name: '김지원',
    // piiExtension result hook이 복호화한 평문 (mock에서는 string으로 직접 제공).
    phone: '01012345678',
    passwordHash: '$2b$12$abcdefghijklmnopqrstuv',
    status: 'ACTIVE',
    authProviders: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('getProfile', () => {
  it('이름/이메일 반환 + phone 마스킹 + hasPassword=true', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(userRow());

    const dto = await getProfile(42);

    expect(dto.name).toBe('김지원');
    expect(dto.email).toBe('kim@example.com');
    expect(dto.phoneMasked).toBe('010-****-5678');
    expect(dto.hasPassword).toBe(true);
    expect(dto.providers).toEqual([]);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 42 } }),
    );
  });

  it('평문 phone / passwordHash는 DTO에 노출되지 않는다 (L-006)', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(userRow());

    const dto = await getProfile(42);
    const serialized = JSON.stringify(dto);

    expect(serialized).not.toContain('01012345678');
    expect(serialized).not.toContain('$2b$12$');
    expect(Object.keys(dto)).not.toContain('phone');
    expect(Object.keys(dto)).not.toContain('passwordHash');
  });

  it('passwordHash=null → hasPassword=false (소셜 전용), phone=null → phoneMasked=null', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(userRow({ passwordHash: null, phone: null }));

    const dto = await getProfile(42);

    expect(dto.hasPassword).toBe(false);
    expect(dto.phoneMasked).toBeNull();
  });

  it('소셜 계정 매핑 — GOOGLE/GITHUB → google/github + linkedAt ISO', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(
      userRow({
        authProviders: [
          { provider: 'GOOGLE', linkedAt: new Date('2026-01-02T03:04:05Z') },
          { provider: 'GITHUB', linkedAt: new Date('2026-02-03T04:05:06Z') },
        ],
      }),
    );

    const dto = await getProfile(42);

    expect(dto.providers).toEqual([
      { provider: 'google', linkedAt: '2026-01-02T03:04:05.000Z' },
      { provider: 'github', linkedAt: '2026-02-03T04:05:06.000Z' },
    ]);
  });

  it('사용자 미존재 → USER_NOT_FOUND (AppError)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(getProfile(999)).rejects.toBeInstanceOf(AppError);
    await expect(getProfile(999)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('탈퇴 계정(status=WITHDRAWN) → USER_NOT_FOUND', async () => {
    prisma.user.findUnique.mockResolvedValue(userRow({ status: 'WITHDRAWN' }));

    await expect(getProfile(42)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  // QA P2: provider 정렬은 Prisma orderBy에 위임 — 정렬 자체가 아닌 "인자 전달 계약"을 가드한다.
  it('authProviders를 linkedAt 오름차순 + provider/linkedAt select로 조회한다 (계약)', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(userRow());

    await getProfile(42);

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 42 },
        include: {
          authProviders: {
            select: { provider: true, linkedAt: true },
            orderBy: { linkedAt: 'asc' },
          },
        },
      }),
    );
  });

  // QA P2: DB 장애를 USER_NOT_FOUND로 오삼키지 않고 그대로 전파해야 한다 (오류 은폐 방지).
  it('prisma 조회 실패는 USER_NOT_FOUND로 삼키지 않고 전파', async () => {
    const dbError = new Error('DB down');
    prisma.user.findUnique.mockRejectedValueOnce(dbError);

    await expect(getProfile(42)).rejects.toBe(dbError);
  });
});
