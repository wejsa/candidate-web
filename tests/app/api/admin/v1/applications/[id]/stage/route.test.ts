// CANDID-053 Step 6 — PATCH /api/admin/v1/applications/[id]/stage 라우터 테스트 (RBAC + 배선).
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';

vi.mock('@/lib/auth/require-role', () => ({ requireRole: vi.fn() }));
vi.mock('@/lib/admin/stage-transition', () => ({ transitionApplicationStage: vi.fn() }));

const { requireRole } = (await import('@/lib/auth/require-role')) as unknown as {
  requireRole: Mock;
};
const { transitionApplicationStage } =
  (await import('@/lib/admin/stage-transition')) as unknown as {
    transitionApplicationStage: Mock;
  };
const { PATCH } = await import('@/app/api/admin/v1/applications/[id]/stage/route');

function patch(id: string, body: unknown): NextRequest {
  return new NextRequest(`https://candidate.example.com/api/admin/v1/applications/${id}/stage`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const ctx = (id: string) => ({ params: { id } });

beforeEach(() => {
  vi.resetAllMocks();
  requireRole.mockResolvedValue({ userId: 42, role: 'RECRUITER' });
});

describe('PATCH /api/admin/v1/applications/[id]/stage', () => {
  it('권한 부족 → 403, 서비스 미호출', async () => {
    requireRole.mockRejectedValue(new AppError('AUTH_FORBIDDEN'));
    const res = await PATCH(patch('10', { toStage: 'DOC_REVIEW' }), ctx('10'));
    expect(res.status).toBe(403);
    expect(transitionApplicationStage).not.toHaveBeenCalled();
  });

  it('정상 → 200 + actor/toStage 배선', async () => {
    transitionApplicationStage.mockResolvedValue({
      applicationId: 10,
      fromStage: 'SUBMITTED',
      toStage: 'DOC_REVIEW',
      result: 'IN_PROGRESS',
    });
    const res = await PATCH(patch('10', { toStage: 'DOC_REVIEW' }), ctx('10'));
    expect(res.status).toBe(200);
    expect(transitionApplicationStage.mock.calls[0]![0]).toMatchObject({
      actorUserId: 42,
      applicationId: 10,
      toStage: 'DOC_REVIEW',
    });
  });

  it('무효 toStage enum → 400 (서비스 미호출)', async () => {
    const res = await PATCH(patch('10', { toStage: 'BOGUS' }), ctx('10'));
    expect(res.status).toBe(400);
    expect(transitionApplicationStage).not.toHaveBeenCalled();
  });

  it('불법 전이 → 422 APP_INVALID_STAGE_TRANSITION (도메인 에러 변환)', async () => {
    transitionApplicationStage.mockRejectedValue(new AppError('APP_INVALID_STAGE_TRANSITION'));
    const res = await PATCH(patch('10', { toStage: 'HIRED' }), ctx('10'));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('APP_INVALID_STAGE_TRANSITION');
  });

  it('미존재 지원서 → 404 APP_NOT_FOUND', async () => {
    transitionApplicationStage.mockRejectedValue(new AppError('APP_NOT_FOUND'));
    const res = await PATCH(patch('999', { toStage: 'DOC_REVIEW' }), ctx('999'));
    expect(res.status).toBe(404);
  });

  it('추가 필드 주입(.strict 위반) → 400, 서비스 미호출', async () => {
    const res = await PATCH(patch('10', { toStage: 'DOC_REVIEW', result: 'PASSED' }), ctx('10'));
    expect(res.status).toBe(400);
    expect(transitionApplicationStage).not.toHaveBeenCalled();
  });

  it('무효 id(0) → 400, 서비스 미호출', async () => {
    const res = await PATCH(patch('0', { toStage: 'DOC_REVIEW' }), ctx('0'));
    expect(res.status).toBe(400);
    expect(transitionApplicationStage).not.toHaveBeenCalled();
  });
});
