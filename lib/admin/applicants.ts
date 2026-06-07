import 'server-only';
import { AuditEventType, StageType, ApplicationResult } from '@prisma/client';
import type { PortfolioLinkType, VirusScanStatus } from '@prisma/client';
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

// CANDID-053 — 기본 페이지 크기. v1 API(/api/admin/v1/.../applications) 응답 계약 보존을 위해 변경 금지.
const DEFAULT_PER_PAGE = 20;
// CANDID-054 FR-002 — 운영 대시보드 전용 밀도(한 화면에 더 많이). 호출측(page.tsx)에서만 args.perPage로 주입.
//   PER_PAGE 상수를 직접 올리면 동일 함수를 공유하는 v1 API 페이지 크기까지 바뀌므로(계약 누수) 인자로 분리.
export const OPERATOR_DASHBOARD_PER_PAGE = 50;

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
  /** 어느 공고의 지원자인지 식별용 — 제목은 PII 아님(마스킹/감사 비대상). */
  posting: { id: number; title: string };
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
  /** 페이지 크기. 미지정 시 DEFAULT_PER_PAGE(20) — v1 API 계약 보존. 운영 대시보드만 OPERATOR_DASHBOARD_PER_PAGE 전달. */
  perPage?: number;
}

/** 공고별 지원자 목록 — 페이지네이션 + 마스킹. idx_applications_posting_stage 활용. */
export async function listApplicantsByPosting(
  args: ListApplicantsArgs,
): Promise<ApplicantListResult> {
  const { jobPostingId, page } = args;
  const perPage = args.perPage ?? DEFAULT_PER_PAGE;

  // 공고 존재 검증 — 미존재 공고로 enumeration/오조회 차단. title은 헤더 식별용으로 함께 조회(추가 쿼리 없음).
  const posting = await basePrisma.jobPosting.findUnique({
    where: { id: jobPostingId },
    select: { id: true, title: true },
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
      skip: (page - 1) * perPage,
      take: perPage,
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

  const totalPages = total === 0 ? 1 : Math.ceil(total / perPage);

  return {
    posting: { id: posting.id, title: posting.title },
    items: rows.map((r) => ({
      applicationId: r.id,
      applicationNumber: r.applicationNumber,
      currentStage: r.currentStage,
      result: r.result,
      submittedAt: r.submittedAt,
      applicantNameMasked: maskName(r.user.name),
      applicantEmailMasked: maskEmail(r.user.email),
    })),
    pagination: { page, perPage, total, totalPages, hasMore: page < totalPages },
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
  // total은 단계 합으로 산출. 두 groupBy는 동일 where(jobPostingId)를 쓰지만 비-트랜잭션 분리 실행이므로
  // 동시 전이/제출 시 Σstage와 Σresult가 순간적으로 어긋날 수 있다(읽기 전용 KPI — 허용).
  const total = Object.values(byStage).reduce((sum, n) => sum + n, 0);

  return { total, byStage, byResult };
}

export interface ApplicantStatusHistoryEntry {
  fromStage: StageType | null;
  toStage: StageType;
  changedAt: Date;
  changedByUserId: number | null;
}

/** 첨부 이력서 메타 (CANDID-066) — app당 최대 1건(BR-FILE).
 *  ⚠️ storedPath(S3 키)·checksum 등 내부 메타는 의도적으로 비노출 — 경로 추측/직접접근 차단. */
export interface ApplicantResumeFileMeta {
  id: number;
  originalFilename: string;
  contentType: string;
  /** bytes. Prisma BigInt → number 변환(JSON 직렬화 + UI 표기용). */
  fileSize: number;
  virusScanStatus: VirusScanStatus;
  uploadedAt: Date;
}

/** 포트폴리오 링크 (CANDID-066) — 표시 전용(서버 fetch 없음). */
export interface ApplicantPortfolioLinkView {
  id: number;
  linkType: PortfolioLinkType;
  url: string;
  memo: string | null;
  sortOrder: number;
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
  /** 첨부 이력서 메타 (없으면 null). 실제 파일 다운로드는 별도 보안 엔드포인트(presigned). */
  resumeFile: ApplicantResumeFileMeta | null;
  /** 포트폴리오 링크 (sortOrder asc). */
  portfolioLinks: ApplicantPortfolioLinkView[];
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
      // CANDID-066 — 첨부/포트폴리오. resumeFiles는 storedPath·checksum 미선택(내부 경로 비노출).
      resumeFiles: {
        select: {
          id: true,
          originalFilename: true,
          contentType: true,
          fileSize: true,
          virusScanStatus: true,
          uploadedAt: true,
        },
      },
      portfolioLinks: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, linkType: true, url: true, memo: true, sortOrder: true },
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
    // app당 최대 1건(부분 UNIQUE) — 첫 건만 노출. BigInt fileSize → number.
    resumeFile:
      app.resumeFiles.length > 0
        ? {
            id: app.resumeFiles[0]!.id,
            originalFilename: app.resumeFiles[0]!.originalFilename,
            contentType: app.resumeFiles[0]!.contentType,
            fileSize: Number(app.resumeFiles[0]!.fileSize),
            virusScanStatus: app.resumeFiles[0]!.virusScanStatus,
            uploadedAt: app.resumeFiles[0]!.uploadedAt,
          }
        : null,
    portfolioLinks: app.portfolioLinks.map((l) => ({
      id: l.id,
      linkType: l.linkType,
      url: l.url,
      memo: l.memo,
      sortOrder: l.sortOrder,
    })),
  };
}
