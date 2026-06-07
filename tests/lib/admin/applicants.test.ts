import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { maskName, maskEmail } from '@/lib/pii/mask';

// CANDID-053 Step 5 — 운영자 지원자 목록/상세 서비스 단위 테스트.
// 핵심 가드: (1) 목록 마스킹(평문 미노출), (2) 상세 PII_VIEW 감사 + metadata PII-free, (3) 동결 snapshot 복호화.

vi.mock('@/lib/prisma', () => ({
  basePrisma: {
    jobPosting: { findUnique: vi.fn() },
    application: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), groupBy: vi.fn() },
  },
}));
vi.mock('@/lib/audit/record', () => ({ recordAuditEvent: vi.fn() }));
// keyVersion-aware compute 함수 결정적 스텁 — 각 snapshot 첫 바이트를 `dec:<n>`로 환원.
// (factory 내부에서 헬퍼 정의 — vi.mock 호이스팅으로 외부 변수 참조 불가)
vi.mock('@/lib/prisma/extends', () => {
  const decSnap = (field: string) =>
    vi.fn((a: Record<string, Uint8Array | null>) =>
      a[field] == null ? null : `dec:${(a[field] as Uint8Array)[0]}`,
    );
  return {
    computeDecryptedApplicantName: decSnap('applicantNameSnapshot'),
    computeDecryptedApplicantEmail: decSnap('applicantEmailSnapshot'),
    computeDecryptedPhoneSnapshot: decSnap('phoneSnapshot'),
    computeDecryptedBirthDateSnapshot: decSnap('birthDateSnapshot'),
    computeDecryptedAddressSnapshot: decSnap('addressSnapshot'),
  };
});

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: {
    jobPosting: { findUnique: Mock };
    application: { count: Mock; findMany: Mock; findUnique: Mock; groupBy: Mock };
  };
};
const { recordAuditEvent } = (await import('@/lib/audit/record')) as unknown as {
  recordAuditEvent: Mock;
};
const { listApplicantsByPosting, getApplicantDetailForOperator, getApplicantStatsByPosting } =
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

  it('페이지네이션 계산 + skip/take (기본 PER_PAGE=20, v1 API 계약 보존)', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValue({ id: 1 });
    basePrisma.application.count.mockResolvedValue(45);
    basePrisma.application.findMany.mockResolvedValue([]);
    // perPage 미지정 → 기본 20(v1 API 계약 보존).
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

  it('운영 대시보드 perPage(50) 주입 시 skip/take/perPage 반영', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValue({ id: 1 });
    basePrisma.application.count.mockResolvedValue(120);
    basePrisma.application.findMany.mockResolvedValue([]);
    const res = await listApplicantsByPosting({ jobPostingId: 1, page: 2, perPage: 50 });
    expect(res.pagination).toMatchObject({ page: 2, perPage: 50, total: 120, totalPages: 3, hasMore: true });
    const callArg = basePrisma.application.findMany.mock.calls[0]![0];
    expect(callArg.skip).toBe(50);
    expect(callArg.take).toBe(50);
  });

  it('빈 목록(total=0) → totalPages=1, hasMore=false', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValue({ id: 1 });
    basePrisma.application.count.mockResolvedValue(0);
    basePrisma.application.findMany.mockResolvedValue([]);
    const res = await listApplicantsByPosting({ jobPostingId: 1, page: 1 });
    expect(res.items).toEqual([]);
    expect(res.pagination).toMatchObject({ total: 0, totalPages: 1, hasMore: false });
  });
});

describe('getApplicantStatsByPosting (CANDID-054 FR-002)', () => {
  it('단계/결과 groupBy를 0-fill 레코드로 매핑 + total 정합(=Σstage=Σresult)', async () => {
    basePrisma.application.groupBy
      .mockResolvedValueOnce([
        { currentStage: 'DOC_REVIEW', _count: { _all: 3 } },
        { currentStage: 'INTERVIEW_1', _count: { _all: 2 } },
        { currentStage: 'HIRED', _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([
        { result: 'IN_PROGRESS', _count: { _all: 5 } },
        { result: 'PASSED', _count: { _all: 1 } },
      ]);

    const stats = await getApplicantStatsByPosting(7);

    // 전체 enum 키가 존재(미보고 단계는 0).
    expect(stats.byStage.SUBMITTED).toBe(0);
    expect(stats.byStage.DOC_REVIEW).toBe(3);
    expect(stats.byStage.INTERVIEW_1).toBe(2);
    expect(stats.byStage.HIRED).toBe(1);
    expect(stats.byStage.REJECTED).toBe(0);
    expect(stats.byResult.IN_PROGRESS).toBe(5);
    expect(stats.byResult.PASSED).toBe(1);
    expect(stats.byResult.FAILED).toBe(0);
    expect(stats.byResult.WITHDRAWN).toBe(0);

    // total = Σstage(6). 결과 합도 동일 모집단(6).
    expect(stats.total).toBe(6);
    const sumStage = Object.values(stats.byStage).reduce((a, b) => a + b, 0);
    const sumResult = Object.values(stats.byResult).reduce((a, b) => a + b, 0);
    expect(sumStage).toBe(6);
    expect(sumResult).toBe(6);

    // where 절에 jobPostingId 반영, 카운트만(_all) 산출.
    const stageCall = basePrisma.application.groupBy.mock.calls[0]![0];
    expect(stageCall.where).toEqual({ jobPostingId: 7 });
    expect(stageCall.by).toEqual(['currentStage']);
  });

  it('지원 0건 공고 → 전 키 0, total 0', async () => {
    basePrisma.application.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const stats = await getApplicantStatsByPosting(99);
    expect(stats.total).toBe(0);
    expect(Object.values(stats.byStage).every((n) => n === 0)).toBe(true);
    expect(Object.values(stats.byResult).every((n) => n === 0)).toBe(true);
  });

  it('단계/결과 두 groupBy가 동일 where(모집단)로 조회됨', async () => {
    // total(Σstage)이 결과 분포와 정합하려면 두 groupBy의 모집단(where)이 동일해야 한다.
    // mock 대칭이 아닌 where 인자 자체를 검증해 한쪽 필터 누락 회귀를 탐지.
    basePrisma.application.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await getApplicantStatsByPosting(7);
    const stageCall = basePrisma.application.groupBy.mock.calls[0]![0];
    const resultCall = basePrisma.application.groupBy.mock.calls[1]![0];
    expect(resultCall.where).toEqual(stageCall.where);
    expect(resultCall.where).toEqual({ jobPostingId: 7 });
    expect(resultCall.by).toEqual(['result']);
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
      applicantNameSnapshotKeyVersion: 1,
      applicantEmailSnapshot: Uint8Array.of(22),
      applicantEmailSnapshotKeyVersion: 1,
      phoneSnapshot: Uint8Array.of(33),
      phoneSnapshotKeyVersion: 1,
      birthDateSnapshot: Uint8Array.of(44),
      birthDateSnapshotKeyVersion: 1,
      addressSnapshot: null,
      addressSnapshotKeyVersion: 1,
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

  it('철회(WITHDRAWN) 지원서도 동결 snapshot 복호화 + PII_VIEW 감사', async () => {
    // BR-PII-03 정합 — 철회 건도 운영 추적 목적상 노출(동결 snapshot 복호화), 열람은 감사됨.
    basePrisma.application.findUnique.mockResolvedValue({
      ...appRow(),
      result: 'WITHDRAWN',
      withdrawnAt: new Date('2026-06-02T00:00:00Z'),
    });
    const detail = await getApplicantDetailForOperator({ actorUserId: 1, applicationId: 10 });
    expect(detail.result).toBe('WITHDRAWN');
    expect(detail.withdrawnAt).toEqual(new Date('2026-06-02T00:00:00Z'));
    expect(detail.applicant.name).toBe('dec:11');
    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    // ip/ua 미전달 → null 정규화.
    expect(recordAuditEvent.mock.calls[0]![0].ipAddress).toBeNull();
    expect(recordAuditEvent.mock.calls[0]![0].userAgent).toBeNull();
  });
});
