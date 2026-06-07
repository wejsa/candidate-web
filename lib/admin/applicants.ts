import 'server-only';
import { AuditEventType, StageType, ApplicationResult } from '@prisma/client';
import { basePrisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { recordAuditEvent } from '@/lib/audit/record';
import { maskName, maskEmail } from '@/lib/pii/mask';
import {
  computeDecryptedApplicantName,
  computeDecryptedApplicantEmail,
  computeDecryptedPhoneSnapshot,
  computeDecryptedBirthDateSnapshot,
  computeDecryptedAddressSnapshot,
} from '@/lib/prisma/extends';

// CANDID-053 Step 5 — 운영자 지원자 목록/상세 (RBAC, A안. FR-006).
//
// PII 통제(리스크 — MAJOR):
//   - 목록: PII snapshot(Bytes) 컬럼을 **select 회피**하고 User.name/email(평문)만 조인 후 마스킹.
//     대량 복호화·평문 노출 회피. 운영자는 식별 단서만 본다.
//   - 상세: 제출 시점 동결 snapshot(BR-PII-03)을 복호화해 전수 노출 — *명시 열람*이므로 PII_VIEW 감사.
//     평문 PII는 감사 metadata에 절대 기록하지 않는다(BR-PII-01, recordAuditEvent PII-free 가드).
//   - 조회는 basePrisma(extension 우회) — User.phone/birthDate 자동 복호화를 트리거하지 않는다.

// CANDID-054 FR-002 — 운영 대시보드는 한 화면에 더 많은 지원자를 노출(밀도↑). 공개 목록(20)과 분리된 운영 전용 페이지 크기.
const PER_PAGE = 50;

export interface ApplicantListItem {
  applicationId: number;
  applicationNumber: string;
  currentStage: StageType;
  result: ApplicationResult;
  submittedAt: Date;
  /** 마스킹된 식별 단서 — 평문 아님. */
  applicantNameMasked: string | null;
  applicantEmailMasked: string | null;
}

export interface ApplicantListResult {
  items: ApplicantListItem[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface ListApplicantsArgs {
  jobPostingId: number;
  page: number;
  stage?: StageType | null;
}

/** 공고별 지원자 목록 — 페이지네이션 + 마스킹. idx_applications_posting_stage 활용. */
export async function listApplicantsByPosting(
  args: ListApplicantsArgs,
): Promise<ApplicantListResult> {
  const { jobPostingId, page } = args;

  // 공고 존재 검증 — 미존재 공고로 enumeration/오조회 차단.
  const posting = await basePrisma.jobPosting.findUnique({
    where: { id: jobPostingId },
    select: { id: true },
  });
  if (posting === null) {
    throw new AppError('JOB_NOT_FOUND');
  }

  const where = {
    jobPostingId,
    ...(args.stage ? { currentStage: args.stage } : {}),
  };

  const [total, rows] = await Promise.all([
    basePrisma.application.count({ where }),
    basePrisma.application.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      // PII snapshot Bytes 컬럼 미선택 — 평문 User.name/email만(마스킹 대상).
      select: {
        id: true,
        applicationNumber: true,
        currentStage: true,
        result: true,
        submittedAt: true,
        user: { select: { name: true, email: true } },
      },
    }),
  ]);

  const totalPages = total === 0 ? 1 : Math.ceil(total / PER_PAGE);

  return {
    items: rows.map((r) => ({
      applicationId: r.id,
      applicationNumber: r.applicationNumber,
      currentStage: r.currentStage,
      result: r.result,
      submittedAt: r.submittedAt,
      applicantNameMasked: maskName(r.user.name),
      applicantEmailMasked: maskEmail(r.user.email),
    })),
    pagination: { page, perPage: PER_PAGE, total, totalPages, hasMore: page < totalPages },
  };
}

// ── CANDID-054 FR-002 — 공고별 지원자 대시보드 집계 ────────────────────────────
//   KPI/분포는 **카운트만** 산출한다(평문 PII 미접촉, basePrisma). PII 컬럼을 일절 select하지 않으므로
//   운영자에게 식별 정보가 노출되지 않는다(목록 마스킹·상세 PII_VIEW 감사와 동일한 통제 정신).
//   idx_applications_posting_stage 인덱스를 활용한 단일 groupBy ×2(단계/결과) 병렬.

/** 공고별 지원 분포(전형 단계별·결과별 카운트). enum 전 키를 0으로 채워 정합(total=Σstage=Σresult). */
export interface ApplicantStageStats {
  total: number;
  byStage: Record<StageType, number>;
  byResult: Record<ApplicationResult, number>;
}

function zeroFilled<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;
}

/** 공고별 지원자 KPI 집계 — 단계/결과 groupBy(카운트만). 공고 존재 검증은 호출측 목록 조회가 담당. */
export async function getApplicantStatsByPosting(
  jobPostingId: number,
): Promise<ApplicantStageStats> {
  const [stageGroups, resultGroups] = await Promise.all([
    basePrisma.application.groupBy({
      by: ['currentStage'],
      where: { jobPostingId },
      _count: { _all: true },
    }),
    basePrisma.application.groupBy({
      by: ['result'],
      where: { jobPostingId },
      _count: { _all: true },
    }),
  ]);

  const byStage = zeroFilled(Object.values(StageType));
  for (const g of stageGroups) {
    byStage[g.currentStage] = g._count._all;
  }
  const byResult = zeroFilled(Object.values(ApplicationResult));
  for (const g of resultGroups) {
    byResult[g.result] = g._count._all;
  }
  // total은 단계 합으로 산출(=결과 합). 두 groupBy는 동일 모집단이므로 정합.
  const total = Object.values(byStage).reduce((sum, n) => sum + n, 0);

  return { total, byStage, byResult };
}

export interface ApplicantStatusHistoryEntry {
  fromStage: StageType | null;
  toStage: StageType;
  changedAt: Date;
  changedByUserId: number | null;
}

export interface ApplicantDetail {
  applicationId: number;
  applicationNumber: string;
  jobPosting: { id: number; title: string };
  currentStage: StageType;
  result: ApplicationResult;
  submittedAt: Date;
  withdrawnAt: Date | null;
  /** 제출 시점 동결 PII (복호화 평문) — 운영자 명시 열람 전용, PII_VIEW 감사됨. */
  applicant: {
    name: string | null;
    email: string | null;
    phone: string | null;
    birthDate: string | null;
    address: string | null;
  };
  statusHistory: ApplicantStatusHistoryEntry[];
}

export interface GetApplicantDetailArgs {
  actorUserId: number;
  applicationId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** 운영자 지원서 상세 — 동결 snapshot 복호화 + PII_VIEW 감사(명시 열람). */
export async function getApplicantDetailForOperator(
  args: GetApplicantDetailArgs,
): Promise<ApplicantDetail> {
  const app = await basePrisma.application.findUnique({
    where: { id: args.applicationId },
    select: {
      id: true,
      applicationNumber: true,
      jobPostingId: true,
      currentStage: true,
      result: true,
      submittedAt: true,
      withdrawnAt: true,
      jobPosting: { select: { id: true, title: true } },
      // snapshot + keyVersion 쌍 — 키 회전(v2) 대비 keyVersion-aware compute 함수에 그대로 전달.
      applicantNameSnapshot: true,
      applicantNameSnapshotKeyVersion: true,
      applicantEmailSnapshot: true,
      applicantEmailSnapshotKeyVersion: true,
      phoneSnapshot: true,
      phoneSnapshotKeyVersion: true,
      birthDateSnapshot: true,
      birthDateSnapshotKeyVersion: true,
      addressSnapshot: true,
      addressSnapshotKeyVersion: true,
      statusHistories: {
        orderBy: { changedAt: 'desc' },
        select: { fromStage: true, toStage: true, changedAt: true, changedByUserId: true },
      },
    },
  });
  if (app === null) {
    throw new AppError('APP_NOT_FOUND');
  }

  // 명시 PII 열람 감사 — 평문 PII는 metadata에 절대 미기록(BR-PII-01). 식별은 resourceId(applicationId)만.
  // ⚠️ fail-closed 의도: fail-open 래퍼(recordAuditEventSafe)가 아닌 recordAuditEvent를 쓴다.
  //   감사 INSERT 실패 시 throw → 호출측 500. 감사 없는 PII 열람은 개인정보보호법상 추적 불가
  //   열람이므로 "감사 우선"으로 차단하는 것이 의도된 동작이다(CANDID-053 Step 11 리뷰). fail-open 전환 금지.
  await recordAuditEvent({
    eventType: AuditEventType.PII_VIEW,
    actorUserId: args.actorUserId,
    resourceType: 'application',
    resourceId: String(app.id),
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
    metadata: { jobPostingId: app.jobPostingId },
  });

  return {
    applicationId: app.id,
    applicationNumber: app.applicationNumber,
    jobPosting: app.jobPosting,
    currentStage: app.currentStage,
    result: app.result,
    submittedAt: app.submittedAt,
    withdrawnAt: app.withdrawnAt,
    // 동결 snapshot 복호화 — keyVersion-aware compute 함수(SSOT) 재사용으로 키 회전 시 회귀 방지.
    applicant: {
      name: computeDecryptedApplicantName(app),
      email: computeDecryptedApplicantEmail(app),
      phone: computeDecryptedPhoneSnapshot(app),
      birthDate: computeDecryptedBirthDateSnapshot(app),
      address: computeDecryptedAddressSnapshot(app),
    },
    statusHistory: app.statusHistories.map((h) => ({
      fromStage: h.fromStage,
      toStage: h.toStage,
      changedAt: h.changedAt,
      changedByUserId: h.changedByUserId,
    })),
  };
}
