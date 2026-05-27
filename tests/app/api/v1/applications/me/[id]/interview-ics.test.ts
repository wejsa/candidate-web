// CANDID-019 Step 2 — GET /api/v1/applications/me/[id]/interview.ics 라우터 테스트.

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { InterviewScheduleStatus, StageType } from '@prisma/client';
import { AppError } from '@/lib/errors';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/my-page/detail-service', () => ({
  getMyInterviewSchedule: vi.fn(),
}));

const { requireAuth } = (await import('@/lib/auth/middleware')) as unknown as {
  requireAuth: Mock;
};
const { getMyInterviewSchedule } = (await import(
  '@/lib/my-page/detail-service'
)) as unknown as { getMyInterviewSchedule: Mock };
const { GET } = await import('@/app/api/v1/applications/me/[id]/interview.ics/route');

const SAMPLE_SCHEDULE = {
  id: 7,
  stage: StageType.INTERVIEW_1,
  scheduledAt: new Date('2026-05-30T05:00:00Z'),
  locationOrUrl: '서울시 강남구',
  status: InterviewScheduleStatus.SCHEDULED,
  icsUid: 'iv-7@cw.example.com',
  applicationNumber: 'A-202605-00001',
  jobTitle: '백엔드 엔지니어',
};

function getRequest(scheduleId: string | null = '7'): NextRequest {
  const url = scheduleId === null
    ? 'https://candidate.example.com/api/v1/applications/me/100/interview.ics'
    : `https://candidate.example.com/api/v1/applications/me/100/interview.ics?scheduleId=${scheduleId}`;
  return new NextRequest(url, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ userId: 42 });
  getMyInterviewSchedule.mockResolvedValue(SAMPLE_SCHEDULE);
});

describe('GET /api/v1/applications/me/[id]/interview.ics — 정상', () => {
  it('200 + text/calendar 응답 + RFC 5545 형식', async () => {
    const response = await GET(getRequest(), { params: { id: '100' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/calendar');
    expect(response.headers.get('Content-Type')).toContain('utf-8');
    expect(response.headers.get('Content-Disposition')).toContain('attachment');
    expect(response.headers.get('Content-Disposition')).toContain('iv-7@cw.example.com');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');

    const body = await response.text();
    expect(body).toContain('BEGIN:VCALENDAR\r\n');
    expect(body).toContain('UID:iv-7@cw.example.com\r\n');
    expect(body).toContain('DTSTART:20260530T050000Z\r\n');
    expect(body).toContain('SUMMARY:백엔드 엔지니어 1차 면접 면접 안내\r\n');
    expect(body).toContain('LOCATION:서울시 강남구\r\n');
    expect(body).toContain('DESCRIPTION:지원 번호: A-202605-00001\r\n');
    expect(body).toContain('END:VCALENDAR\r\n');
  });

  it('서비스 호출 인자 — userId/applicationId/scheduleId 정합', async () => {
    await GET(getRequest('7'), { params: { id: '100' } });
    expect(getMyInterviewSchedule).toHaveBeenCalledWith(42, 100, 7);
  });
});

describe('GET interview.ics — applicationId/scheduleId 검증', () => {
  it('scheduleId 누락 → 400 SYS_VALIDATION_FAILED', async () => {
    const response = await GET(getRequest(null), { params: { id: '100' } });
    expect(response.status).toBe(400);
    expect(getMyInterviewSchedule).not.toHaveBeenCalled();
  });

  it('scheduleId 비-숫자 → 400', async () => {
    const response = await GET(getRequest('abc'), { params: { id: '100' } });
    expect(response.status).toBe(400);
  });

  it('applicationId 비-숫자 → 400', async () => {
    const response = await GET(getRequest('7'), { params: { id: 'abc' } });
    expect(response.status).toBe(400);
  });

  it('scheduleId 음수 → 400', async () => {
    const response = await GET(getRequest('-1'), { params: { id: '100' } });
    expect(response.status).toBe(400);
  });
});

describe('GET interview.ics — 인증/권한', () => {
  it('AUTH_TOKEN_INVALID → 401 + 서비스 미호출', async () => {
    requireAuth.mockRejectedValueOnce(new AppError('AUTH_TOKEN_INVALID'));
    const response = await GET(getRequest(), { params: { id: '100' } });
    expect(response.status).toBe(401);
    expect(getMyInterviewSchedule).not.toHaveBeenCalled();
  });

  it('FILE_NOT_FOUND (ownership 위반/스케줄 미존재) → 404', async () => {
    getMyInterviewSchedule.mockRejectedValueOnce(new AppError('FILE_NOT_FOUND'));
    const response = await GET(getRequest(), { params: { id: '100' } });
    expect(response.status).toBe(404);
  });
});

describe('GET interview.ics — PII-free', () => {
  it('응답 본문에 사용자 PII(전화/생년월일) 부재', async () => {
    const response = await GET(getRequest(), { params: { id: '100' } });
    const body = await response.text();
    // UID(icsUid)는 RFC 5545 권장 형식 `<id>@<domain>`이라 `@` 자체는 정상.
    // PII 회귀 가드는 전화/생년월일 패턴으로 검증.
    expect(body).not.toMatch(/01\d-\d{4}-\d{4}/);
    expect(body).not.toMatch(/\d{4}-\d{2}-\d{2}T?\d/); // birthDate ISO 부분
    // applicantName 한글이 직접 노출되지 않음 — jobTitle만 허용
    expect(body).not.toContain('홍길동');
  });
});
