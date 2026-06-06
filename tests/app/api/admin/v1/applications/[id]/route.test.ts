// CANDID-053 Step 5 — GET /api/admin/v1/applications/[id] 라우터 테스트 (RBAC + actor 배선).
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';

vi.mock('@/lib/auth/require-role', () => ({ requireRole: vi.fn() }));
vi.mock('@/lib/admin/applicants', () => ({ getApplicantDetailForOperator: vi.fn() }));

const { requireRole } = (await import('@/lib/auth/require-role')) as unknown as {
  requireRole: Mock;
};
const { getApplicantDetailForOperator } = (await import('@/lib/admin/applicants')) as unknown as {
  getApplicantDetailForOperator: Mock;
};
const { GET } = await import('@/app/api/admin/v1/applications/[id]/route');

function get(id: string, ua = 'op-ua'): NextRequest {
  return new NextRequest(`https://candidate.example.com/api/admin/v1/applications/${id}`, {
    headers: { 'user-agent': ua },
  });
}
const ctx = (id: string) => ({ params: { id } });

beforeEach(() => {
  vi.resetAllMocks();
  requireRole.mockResolvedValue({ userId: 42, role: 'RECRUITER' });
});

describe('GET /api/admin/v1/applications/[id]', () => {
  it('권한 부족 → 403, 서비스(PII 복호화) 미호출', async () => {
    requireRole.mockRejectedValue(new AppError('AUTH_FORBIDDEN'));
    const res = await GET(get('10'), ctx('10'));
    expect(res.status).toBe(403);
    expect(getApplicantDetailForOperator).not.toHaveBeenCalled();
  });

  it('정상 → 200 + actor.userId/userAgent를 서비스로 전달', async () => {
    getApplicantDetailForOperator.mockResolvedValue({ applicationId: 10 });
    const res = await GET(get('10', 'op-ua'), ctx('10'));
    expect(res.status).toBe(200);
    expect(getApplicantDetailForOperator.mock.calls[0]![0]).toMatchObject({
      actorUserId: 42,
      applicationId: 10,
      userAgent: 'op-ua',
    });
  });

  it('미존재 지원서 → 404 APP_NOT_FOUND (도메인 에러 변환)', async () => {
    getApplicantDetailForOperator.mockRejectedValue(new AppError('APP_NOT_FOUND'));
    const res = await GET(get('999'), ctx('999'));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('APP_NOT_FOUND');
  });

  it('비숫자 id → 400 (서비스 미호출)', async () => {
    const res = await GET(get('abc'), ctx('abc'));
    expect(res.status).toBe(400);
    expect(getApplicantDetailForOperator).not.toHaveBeenCalled();
  });
});
