import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

// CANDID-053 Step 8 — 백오피스 페이지 역할 가드(보안 경계) 단위 테스트.
// notFound()/redirect()는 흐름을 끊는 sentinel — Next 런타임 동작을 throw로 모사.

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/auth/server-cookies', () => ({ getOptionalAuthFromCookies: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ basePrisma: { user: { findUnique: vi.fn() } } }));

const navigation = (await import('next/navigation')) as unknown as {
  redirect: Mock;
  notFound: Mock;
};
const { getOptionalAuthFromCookies } = (await import('@/lib/auth/server-cookies')) as unknown as {
  getOptionalAuthFromCookies: Mock;
};
const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: { user: { findUnique: Mock } };
};
const { requireOperatorPage } = await import('@/lib/auth/require-role-page');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireOperatorPage', () => {
  it('미인증 → 복귀 경로 보존 redirect, DB 미조회', async () => {
    getOptionalAuthFromCookies.mockResolvedValue(null);
    await expect(requireOperatorPage('/admin/job-postings')).rejects.toThrow('NEXT_REDIRECT');
    expect(navigation.redirect).toHaveBeenCalledWith(
      '/login?redirect=%2Fadmin%2Fjob-postings',
    );
    expect(basePrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('returnTo 기본값 → /admin 복귀', async () => {
    getOptionalAuthFromCookies.mockResolvedValue(null);
    await expect(requireOperatorPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(navigation.redirect).toHaveBeenCalledWith('/login?redirect=%2Fadmin');
  });

  it.each(['RECRUITER', 'ADMIN'])('운영자(%s) → 컨텍스트 반환', async (role) => {
    getOptionalAuthFromCookies.mockResolvedValue({ userId: 42 });
    basePrisma.user.findUnique.mockResolvedValue({ role, status: 'ACTIVE' });
    const ctx = await requireOperatorPage();
    expect(ctx).toEqual({ userId: 42, role });
    expect(navigation.notFound).not.toHaveBeenCalled();
    expect(navigation.redirect).not.toHaveBeenCalled();
  });

  it('CANDIDATE → notFound(백오피스 비노출), redirect 미사용', async () => {
    getOptionalAuthFromCookies.mockResolvedValue({ userId: 7 });
    basePrisma.user.findUnique.mockResolvedValue({ role: 'CANDIDATE', status: 'ACTIVE' });
    await expect(requireOperatorPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(navigation.notFound).toHaveBeenCalledTimes(1);
    expect(navigation.redirect).not.toHaveBeenCalled();
  });

  it('비활성 계정(운영자 역할이어도 status!=ACTIVE) → notFound', async () => {
    getOptionalAuthFromCookies.mockResolvedValue({ userId: 9 });
    basePrisma.user.findUnique.mockResolvedValue({ role: 'ADMIN', status: 'LOCKED' });
    await expect(requireOperatorPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(navigation.notFound).toHaveBeenCalledTimes(1);
  });

  it('계정 부재(토큰은 유효하나 익명화/삭제) → notFound', async () => {
    getOptionalAuthFromCookies.mockResolvedValue({ userId: 999 });
    basePrisma.user.findUnique.mockResolvedValue(null);
    await expect(requireOperatorPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(navigation.notFound).toHaveBeenCalledTimes(1);
  });

  it('인가 SSOT는 DB role — findUnique가 role+status만 select(PII 미조회)', async () => {
    getOptionalAuthFromCookies.mockResolvedValue({ userId: 42 });
    basePrisma.user.findUnique.mockResolvedValue({ role: 'RECRUITER', status: 'ACTIVE' });
    await requireOperatorPage();
    expect(basePrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 42 },
      select: { role: true, status: true },
    });
  });
});
