import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { maskName, maskEmail } from '@/lib/pii/mask';

// CANDID-053 Step 5 — 운영자 지원자 목록/상세 서비스 단위 테스트.
// 핵심 가드: (1) 목록 마스킹(평문 미노출), (2) 상세 PII_VIEW 감사 + metadata PII-free, (3) 동결 snapshot 복호화.

vi.mock('@/lib/prisma', () => ({
  basePrisma: {
    jobPosting: { findUnique: vi.fn() },
    application: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/audit/record', () => ({ recordAuditEvent: vi.fn() }));
// 복호화는 결정적 스텁 — Bytes 입력을 `dec:<n>`로 환원해 평문 매핑을 검증.
vi.mock('@/lib/prisma/extends', () => ({
  decryptUserPiiField: vi.fn((v: Uint8Array | null) =>
    v === null ? null : `dec:${(v as Uint8Array)[0]}`,
  ),
}));

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: {
    jobPosting: { findUnique: Mock };
    application: { count: Mock; findMany: Mock; findUnique: Mock };
  };
};
const { recordAuditEvent } = (await import('@/lib/audit/record')) as unknown as {
  recordAuditEvent: Mock;
};
const { listApplicantsByPosting, getApplicantDetailForOperator } =
  await import('@/lib/admin/applicants');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listApplicantsByPosting', () => {
  it('미존재 공고 → JOB_NOT_FOUND', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValue(null);
    await expect(listApplicantsByPosting({ jobPostingId: 999, page: 1 })).rejects.toMatchObject({
      code: 'JOB_NOT_FOUND',
    });
    expect(basePrisma.application.findMany).not.toHaveBeenCalled();
  });

  it('지원자 식별 정보를 마스킹해 반환(평문 미노출)', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValue({ id: 1 });
    basePrisma.application.count.mockResolvedValue(1);
    basePrisma.application.findMany.mockResolvedValue([
      {
        id: 10,
        applicationNumber: 'A-202606-00001',
        currentStage: 'SUBMITTED',
        result: 'IN_PROGRESS',
        submittedAt: new Date('2026-06-01T00:00:00Z'),
        user: { name: '홍길동', email: 'gildong@example.com' },
      },
    ]);

    const res = await listApplicantsByPosting({ jobPostingId: 1, page: 1 });
    expect(res.items).toHaveLength(1);
    const item = res.items[0]!;
    expect(item.applicantNameMasked).toBe(maskName('홍길동'));
    expect(item.applicantEmailMasked).toBe(maskEmail('gildong@example.com'));
    // 평문이 그대로 새지 않음.
    expect(item.applicantNameMasked).not.toBe('홍길동');
    expect(JSON.stringify(res)).not.toContain('gildong@example.com');
    expect(item.applicationNumber).toBe('A-202606-00001');
  });

  it('stage 필터를 where에 반영', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValue({ id: 1 });
    basePrisma.application.count.mockResolvedValue(0);
    basePrisma.application.findMany.mockResolvedValue([]);
    await listApplicantsByPosting({ jobPostingId: 1, page: 1, stage: 'INTERVIEW_1' as never });
    const callArg = basePrisma.application.findMany.mock.calls[0]![0];
    expect(callArg.where).toMatchObject({ jobPostingId: 1, currentStage: 'INTERVIEW_1' });
  });

  it('페이지네이션 계산 + skip/take', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValue({ id: 1 });
    basePrisma.application.count.mockResolvedValue(45);
    basePrisma.application.findMany.mockResolvedValue([]);
    const res = await listApplicantsByPosting({ jobPostingId: 1, page: 2 });
    expect(res.pagination).toMatchObject({
      page: 2,
      perPage: 20,
      total: 45,
      totalPages: 3,
      hasMore: true,
    });
    const callArg = basePrisma.application.findMany.mock.calls[0]![0];
    expect(callArg.skip).toBe(20);
    expect(callArg.take).toBe(20);
    // PII snapshot Bytes 컬럼을 select하지 않음(평문/암호문 노출 회피).
    expect(callArg.select.phoneSnapshot).toBeUndefined();
    expect(callArg.select.applicantNameSnapshot).toBeUndefined();
  });
});

describe('getApplicantDetailForOperator', () => {
  function appRow() {
    return {
      id: 10,
      applicationNumber: 'A-202606-00001',
      jobPostingId: 7,
      currentStage: 'DOC_REVIEW',
      result: 'IN_PROGRESS',
      submittedAt: new Date('2026-06-01T00:00:00Z'),
      withdrawnAt: null,
      jobPosting: { id: 7, title: '백엔드 엔지니어' },
      applicantNameSnapshot: Uint8Array.of(11),
      applicantEmailSnapshot: Uint8Array.of(22),
      phoneSnapshot: Uint8Array.of(33),
      birthDateSnapshot: Uint8Array.of(44),
      addressSnapshot: null,
      statusHistories: [
        {
          fromStage: 'SUBMITTED',
          toStage: 'DOC_REVIEW',
          changedAt: new Date(),
          changedByUserId: 5,
        },
      ],
    };
  }

  it('미존재 지원서 → APP_NOT_FOUND (감사 미발행)', async () => {
    basePrisma.application.findUnique.mockResolvedValue(null);
    await expect(
      getApplicantDetailForOperator({ actorUserId: 1, applicationId: 999 }),
    ).rejects.toMatchObject({ code: 'APP_NOT_FOUND' });
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it('동결 snapshot 복호화 + PII_VIEW 감사(metadata PII-free)', async () => {
    basePrisma.application.findUnique.mockResolvedValue(appRow());
    const detail = await getApplicantDetailForOperator({
      actorUserId: 42,
      applicationId: 10,
      ipAddress: '10.0.0.1',
      userAgent: 'op-ua',
    });
    // 복호화 평문 매핑(스텁 dec:<byte0>).
    expect(detail.applicant.name).toBe('dec:11');
    expect(detail.applicant.email).toBe('dec:22');
    expect(detail.applicant.phone).toBe('dec:33');
    expect(detail.applicant.address).toBeNull(); // null snapshot → null
    expect(detail.jobPosting.title).toBe('백엔드 엔지니어');

    // 명시 열람 감사.
    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    const audited = recordAuditEvent.mock.calls[0]![0];
    expect(audited.eventType).toBe('PII_VIEW');
    expect(audited.actorUserId).toBe(42);
    expect(audited.resourceType).toBe('application');
    expect(audited.resourceId).toBe('10');
    // metadata에 평문 PII가 새지 않음 — 식별은 jobPostingId만.
    expect(audited.metadata).toEqual({ jobPostingId: 7 });
    expect(JSON.stringify(audited.metadata)).not.toMatch(/dec:|@example|홍길동/);
  });
});
