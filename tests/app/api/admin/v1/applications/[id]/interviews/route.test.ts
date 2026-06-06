// CANDID-053 Step 7 — POST /api/admin/v1/applications/[id]/interviews 라우터 테스트.
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';

vi.mock('@/lib/auth/require-role', () => ({ requireRole: vi.fn() }));
vi.mock('@/lib/admin/interviews', () => ({ upsertInterviewSchedule: vi.fn() }));

const { requireRole } = (await import('@/lib/auth/require-role')) as unknown as {
  requireRole: Mock;
};
const { upsertInterviewSchedule } = (await import('@/lib/admin/interviews')) as unknown as {
  upsertInterviewSchedule: Mock;
};
const { POST } = await import('@/app/api/admin/v1/applications/[id]/interviews/route');

const VALID = {
  stage: 'INTERVIEW_1',
  scheduledAt: '2026-07-01T05:00:00.000Z',
  locationOrUrl: 'https://meet.example.com/a',
};
function post(id: string, body: unknown): NextRequest {
  return new NextRequest(
    `https://candidate.example.com/api/admin/v1/applications/${id}/interviews`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}
const ctx = (id: string) => ({ params: { id } });

beforeEach(() => {
  vi.resetAllMocks();
  requireRole.mockResolvedValue({ userId: 42, role: 'RECRUITER' });
  upsertInterviewSchedule.mockResolvedValue({ interviewId: 55, created: true });
});

describe('POST /api/admin/v1/applications/[id]/interviews', () => {
  it('권한 부족 → 403, 서비스 미호출', async () => {
    requireRole.mockRejectedValue(new AppError('AUTH_FORBIDDEN'));
    const res = await POST(post('10', VALID), ctx('10'));
    expect(res.status).toBe(403);
    expect(upsertInterviewSchedule).not.toHaveBeenCalled();
  });

  it('신규 → 201 + actor/필드 배선', async () => {
    upsertInterviewSchedule.mockResolvedValue({ interviewId: 55, created: true });
    const res = await POST(post('10', VALID), ctx('10'));
    expect(res.status).toBe(201);
    expect(upsertInterviewSchedule.mock.calls[0]![0]).toMatchObject({
      actorUserId: 42,
      applicationId: 10,
      stage: 'INTERVIEW_1',
      locationOrUrl: 'https://meet.example.com/a',
    });
  });

  it('멱등 갱신 → 200', async () => {
    upsertInterviewSchedule.mockResolvedValue({ interviewId: 55, created: false });
    const res = await POST(post('10', VALID), ctx('10'));
    expect(res.status).toBe(200);
  });

  it('면접 외 단계(SUBMITTED) → 400, 서비스 미호출', async () => {
    const res = await POST(post('10', { ...VALID, stage: 'SUBMITTED' }), ctx('10'));
    expect(res.status).toBe(400);
    expect(upsertInterviewSchedule).not.toHaveBeenCalled();
  });

  it('무효 scheduledAt(비-ISO) → 400', async () => {
    const res = await POST(post('10', { ...VALID, scheduledAt: 'not-a-date' }), ctx('10'));
    expect(res.status).toBe(400);
  });

  it('추가 필드(.strict 위반) → 400', async () => {
    const res = await POST(post('10', { ...VALID, status: 'DONE' }), ctx('10'));
    expect(res.status).toBe(400);
  });

  it('미존재 지원서 → 404 APP_NOT_FOUND', async () => {
    upsertInterviewSchedule.mockRejectedValue(new AppError('APP_NOT_FOUND'));
    const res = await POST(post('999', VALID), ctx('999'));
    expect(res.status).toBe(404);
  });
});
