// CANDID-053 Step 3 — PATCH /api/admin/v1/users/[id]/role 라우터 테스트.
// requireRole·changeUserRole을 mock하여 배선/검증/권한 전파를 검증한다.

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';

vi.mock('@/lib/auth/require-role', () => ({ requireRole: vi.fn() }));
vi.mock('@/lib/admin/roles', () => ({ changeUserRole: vi.fn() }));

const { requireRole } = (await import('@/lib/auth/require-role')) as unknown as {
  requireRole: Mock;
};
const { changeUserRole } = (await import('@/lib/admin/roles')) as unknown as {
  changeUserRole: Mock;
};
const { PATCH } = await import('@/app/api/admin/v1/users/[id]/role/route');

function patch(id: string, body: unknown): NextRequest {
  return new NextRequest(`https://candidate.example.com/api/admin/v1/users/${id}/role`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    body: JSON.stringify(body),
  });
}
const ctx = (id: string) => ({ params: { id } });

beforeEach(() => {
  vi.resetAllMocks();
  requireRole.mockResolvedValue({ userId: 1, role: 'ADMIN' });
});

describe('PATCH /api/admin/v1/users/[id]/role', () => {
  it('ADMIN이 역할 변경 → 200 + 결과', async () => {
    changeUserRole.mockResolvedValue({ userId: 9, previousRole: 'CANDIDATE', role: 'RECRUITER', changed: true });
    const res = await PATCH(patch('9', { role: 'RECRUITER' }), ctx('9'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ userId: 9, role: 'RECRUITER' });
    expect(requireRole).toHaveBeenCalledWith(expect.anything(), 'ADMIN');
    expect(changeUserRole).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 1, targetUserId: 9, newRole: 'RECRUITER' }),
    );
  });

  it('잘못된 role 값 → 400 SYS_VALIDATION_FAILED', async () => {
    const res = await PATCH(patch('9', { role: 'KING' }), ctx('9'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('SYS_VALIDATION_FAILED');
    expect(changeUserRole).not.toHaveBeenCalled();
  });

  it('비-ADMIN(권한 부족) → 403 AUTH_FORBIDDEN (requireRole 전파)', async () => {
    requireRole.mockRejectedValue(new AppError('AUTH_FORBIDDEN'));
    const res = await PATCH(patch('9', { role: 'RECRUITER' }), ctx('9'));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('AUTH_FORBIDDEN');
    expect(changeUserRole).not.toHaveBeenCalled();
  });

  it('잘못된 id(0/음수) → 400', async () => {
    const res = await PATCH(patch('0', { role: 'RECRUITER' }), ctx('0'));
    expect(res.status).toBe(400);
  });

  it('도메인 에러(USER_LAST_ADMIN) → 409 표준 응답 변환', async () => {
    changeUserRole.mockRejectedValue(new AppError('USER_LAST_ADMIN'));
    const res = await PATCH(patch('9', { role: 'CANDIDATE' }), ctx('9'));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('USER_LAST_ADMIN');
  });

  it('본인 역할 변경(USER_CANNOT_CHANGE_OWN_ROLE) → 403 표준 응답 변환', async () => {
    changeUserRole.mockRejectedValue(new AppError('USER_CANNOT_CHANGE_OWN_ROLE'));
    const res = await PATCH(patch('1', { role: 'RECRUITER' }), ctx('1'));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('USER_CANNOT_CHANGE_OWN_ROLE');
  });
});
