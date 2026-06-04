// CANDID-053 Step 2 — requireRole 역할 인가 단위 테스트.
// requireAuth(인증)와 basePrisma(role 조회)를 mock하여 인가 분기만 검증한다.

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ basePrisma: { user: { findUnique: vi.fn() } } }));

const { requireAuth } = (await import('@/lib/auth/middleware')) as unknown as {
  requireAuth: Mock;
};
const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: { user: { findUnique: Mock } };
};
const { requireRole } = await import('@/lib/auth/require-role');

function req(): NextRequest {
  return new NextRequest('https://candidate.example.com/api/admin/v1/x', { method: 'GET' });
}

async function expectForbidden(p: Promise<unknown>): Promise<void> {
  await expect(p).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
}

beforeEach(() => {
  vi.resetAllMocks();
  requireAuth.mockResolvedValue({ userId: 7 });
});

describe('requireRole', () => {
  it('allow-list에 포함된 role → { userId, role } 반환', async () => {
    basePrisma.user.findUnique.mockResolvedValue({ role: 'RECRUITER', status: 'ACTIVE' });
    const ctx = await requireRole(req(), 'RECRUITER', 'ADMIN');
    expect(ctx).toEqual({ userId: 7, role: 'RECRUITER' });
  });

  it('ADMIN allow-list에 ADMIN → 통과', async () => {
    basePrisma.user.findUnique.mockResolvedValue({ role: 'ADMIN', status: 'ACTIVE' });
    await expect(requireRole(req(), 'ADMIN')).resolves.toEqual({ userId: 7, role: 'ADMIN' });
  });

  it('allow-list에 없는 role → AUTH_FORBIDDEN (CANDIDATE가 운영 API 접근)', async () => {
    basePrisma.user.findUnique.mockResolvedValue({ role: 'CANDIDATE', status: 'ACTIVE' });
    await expectForbidden(requireRole(req(), 'RECRUITER', 'ADMIN'));
  });

  it('ordinal 비교 아님 — allowed=[ADMIN]에 RECRUITER는 거부(상위/하위 무관, 집합 포함만)', async () => {
    basePrisma.user.findUnique.mockResolvedValue({ role: 'RECRUITER', status: 'ACTIVE' });
    await expectForbidden(requireRole(req(), 'ADMIN'));
  });

  it('계정 부재(탈퇴/익명화) → AUTH_FORBIDDEN', async () => {
    basePrisma.user.findUnique.mockResolvedValue(null);
    await expectForbidden(requireRole(req(), 'ADMIN'));
  });

  it('비활성 상태(LOCKED) → AUTH_FORBIDDEN', async () => {
    basePrisma.user.findUnique.mockResolvedValue({ role: 'ADMIN', status: 'LOCKED' });
    await expectForbidden(requireRole(req(), 'ADMIN'));
  });

  it('탈퇴 상태(WITHDRAWN) → AUTH_FORBIDDEN (회귀 가드)', async () => {
    basePrisma.user.findUnique.mockResolvedValue({ role: 'ADMIN', status: 'WITHDRAWN' });
    await expectForbidden(requireRole(req(), 'ADMIN'));
  });

  it('role 조회 중 DB 오류 → 전파(fail-closed, 통과 안 함)', async () => {
    basePrisma.user.findUnique.mockRejectedValue(new Error('db down'));
    await expect(requireRole(req(), 'ADMIN')).rejects.toThrow('db down');
  });

  it('인증 실패는 그대로 전파 (requireAuth가 throw → role 조회 안 함)', async () => {
    requireAuth.mockRejectedValue(new AppError('AUTH_TOKEN_INVALID'));
    await expect(requireRole(req(), 'ADMIN')).rejects.toMatchObject({ code: 'AUTH_TOKEN_INVALID' });
    expect(basePrisma.user.findUnique).not.toHaveBeenCalled();
  });
});
