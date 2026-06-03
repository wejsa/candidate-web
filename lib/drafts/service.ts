// CANDID-015 Step 1 — Draft 서비스 (US-APP-005).
// - getOrInitDraft: Draft 진입 (없으면 초기 payload 생성 — User PII prefill은 Step 2에서 추가)
// - upsertDraft: 낙관적 락 (L-024 PostgreSQL UPDATE row-level lock으로 race 차단)
// - 마감/DRAFT 공고 차단

import 'server-only';
import { AuditEventType, JobStatus, Prisma } from '@prisma/client';
// CANDID-015 Step 2 L-019 (D-MAJOR-2): wrapped `prisma` import 제거 — service.ts는
// applicationDraft만 다루고 piiExtension 대상 아니므로 basePrisma만 사용. PII wrapper
// 우회 안티패턴 진입점 차단.
import { basePrisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { initialPayload } from '@/lib/drafts/schema';
import { deleteResumeObject } from '@/lib/files/storage';
import { recordAuditEventSafe } from '@/lib/audit/record';
import type { DraftPayloadV1 } from '@/lib/drafts/types';

interface JobGate {
  id: number;
  status: JobStatus;
  closesAt: Date | null;
}

/**
 * 공고가 Draft 작성 가능 상태인지 검증한다.
 * - DRAFT 비공개 → JOB_NOT_FOUND
 * - CLOSED → JOB_CLOSED
 * - closesAt < now → JOB_CLOSED (F-1 cron 미도입 가드)
 */
function assertJobAvailable(job: JobGate | null, now: Date): asserts job is JobGate {
  if (job === null || job.status === JobStatus.DRAFT) {
    throw new AppError('JOB_NOT_FOUND');
  }
  if (job.status === JobStatus.CLOSED) {
    throw new AppError('JOB_CLOSED');
  }
  if (job.closesAt !== null && job.closesAt.getTime() <= now.getTime()) {
    throw new AppError('JOB_CLOSED');
  }
}

interface DraftRow {
  id: number;
  payloadJson: Prisma.JsonValue;
  version: number;
  lastSavedAt: Date;
}

interface GetOrInitResult {
  draft: DraftRow;
  created: boolean;
}

/**
 * Draft 진입 — 없으면 빈 payload + version=1로 신규 생성.
 * User PII prefill은 호출자가 별도 헬퍼(lib/drafts/user-prefill.ts, Step 2)로 처리.
 *
 * 공고 검증:
 * - 존재하지 않음 / DRAFT → JOB_NOT_FOUND
 * - CLOSED 또는 closesAt < now → JOB_CLOSED
 */
export async function getOrInitDraft(
  userId: number,
  jobPostingId: number,
  now: Date = new Date(),
): Promise<GetOrInitResult> {
  // 1) 공고 게이트
  const job = await basePrisma.jobPosting.findUnique({
    where: { id: jobPostingId },
    select: { id: true, status: true, closesAt: true },
  });
  assertJobAvailable(job, now);

  // 2) Draft 조회
  const existing = await basePrisma.applicationDraft.findUnique({
    where: { userId_jobPostingId: { userId, jobPostingId } },
    select: { id: true, payloadJson: true, version: true, lastSavedAt: true },
  });
  if (existing !== null) {
    return { draft: existing, created: false };
  }

  // 3) 신규 — 빈 payload + version=1
  const created = await basePrisma.applicationDraft.create({
    data: {
      userId,
      jobPostingId,
      payloadJson: initialPayload() as unknown as Prisma.InputJsonValue,
      version: 1,
      lastSavedAt: now,
    },
    select: { id: true, payloadJson: true, version: true, lastSavedAt: true },
  });
  return { draft: created, created: true };
}

interface UpsertInput {
  userId: number;
  jobPostingId: number;
  payload: DraftPayloadV1;
  expectedVersion: number;
  now?: Date;
}

interface UpsertResult {
  version: number;
  lastSavedAt: Date;
}

/**
 * Draft 저장 (PUT).
 *
 * 낙관적 락 (L-024): updateMany({ where: { userId, jobPostingId, version: expectedVersion } })
 * → count=1 → 성공, version+1 반환
 * → count=0 → 두 경로 분기:
 *    a) Draft 미존재 + expectedVersion=0 → create (신규 첫 저장)
 *    b) version mismatch → APP_DRAFT_CONFLICT throw
 *
 * 공고 검증은 별도 (호출자가 getOrInitDraft 통과 후 호출 권장 — 본 함수에서도 게이트 재실행).
 */
export async function upsertDraft({
  userId,
  jobPostingId,
  payload,
  expectedVersion,
  now = new Date(),
}: UpsertInput): Promise<UpsertResult> {
  const job = await basePrisma.jobPosting.findUnique({
    where: { id: jobPostingId },
    select: { id: true, status: true, closesAt: true },
  });
  assertJobAvailable(job, now);

  // 신규 경로 (expectedVersion=0)
  if (expectedVersion === 0) {
    try {
      const created = await basePrisma.applicationDraft.create({
        data: {
          userId,
          jobPostingId,
          payloadJson: payload as unknown as Prisma.InputJsonValue,
          version: 1,
          lastSavedAt: now,
        },
        select: { version: true, lastSavedAt: true },
      });
      return created;
    } catch (err) {
      // P2002 UNIQUE 위반 → 다른 탭이 먼저 생성함
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError('APP_DRAFT_CONFLICT');
      }
      throw err;
    }
  }

  // 기존 업데이트 — 낙관적 락
  const result = await basePrisma.applicationDraft.updateMany({
    where: { userId, jobPostingId, version: expectedVersion },
    data: {
      payloadJson: payload as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
      lastSavedAt: now,
    },
  });
  if (result.count === 0) {
    // 두 경우: (a) Draft 미존재 + expectedVersion≠0 → 사용자가 잘못된 version 전송
    //         (b) version mismatch (다른 탭 우선)
    // 두 경우 모두 APP_DRAFT_CONFLICT로 매핑 (정보 노출 차단).
    throw new AppError('APP_DRAFT_CONFLICT');
  }
  // updateMany는 반환 데이터가 없으므로 별도 조회
  const updated = await basePrisma.applicationDraft.findUnique({
    where: { userId_jobPostingId: { userId, jobPostingId } },
    select: { version: true, lastSavedAt: true },
  });
  if (updated === null) {
    // 업데이트 직후 사라짐 (이론상 불가, defense-in-depth)
    throw new AppError('APP_DRAFT_CONFLICT');
  }
  return updated;
}

/**
 * 작성 중 Draft 폐기 (US-MY — 작성 취소). 본인 소유 draft만.
 *
 * BR-FILE-06 배치(cleanupStaleDrafts)와 동일한 순서를 미러:
 *   (1) 첨부 이력서 S3 객체 선삭제 — 트랜잭션 *외부*(BR-TX-02 외부 호출 격리).
 *       하나라도 실패하면 draft 보존 후 throw → orphan S3 방지(사용자 재시도 / 배치 폴백).
 *   (2) 트랜잭션: resume_files row 삭제 → draft 삭제(portfolio_links는 onDelete Cascade).
 *
 * 멱등: draft 미존재면 no-op(이미 폐기됨). 제출 완료로 draft가 사라진 경우도 동일.
 *
 * 감사: 삭제 성공 후 DRAFT_DISCARD 이벤트 기록(recordAuditEventSafe — fail-open).
 *   트랜잭션 내부 기록을 쓰지 않는 이유: S3 객체는 트랜잭션 *전에* 이미 삭제되므로, 트랜잭션이
 *   감사 실패로 롤백되면 "DB row 존재 + S3 없음"의 더 나쁜 orphan이 된다. 따라서 삭제는 끝까지
 *   완료하고 감사는 best-effort로 분리한다(개인정보보호법 추적성 ↔ orphan 회피 trade-off).
 */
export async function discardDraft(
  userId: number,
  jobPostingId: number,
  opts: { userAgent?: string | null } = {},
): Promise<void> {
  const draft = await basePrisma.applicationDraft.findUnique({
    where: { userId_jobPostingId: { userId, jobPostingId } },
    select: { id: true },
  });
  if (draft === null) return; // 멱등 — 이미 없음

  const files = await basePrisma.resumeFile.findMany({
    where: { draftId: draft.id },
    select: { id: true, storedPath: true },
  });

  // (1) S3 객체 선삭제 (트랜잭션 외부). 실패 시 throw — draft 보존(orphan 방지).
  for (const file of files) {
    await deleteResumeObject(file.storedPath);
  }

  // (2) DB 삭제 — resume_files row + draft (portfolio_links Cascade).
  // 동시 제출(submit) 경합 방어: resume_files를 수집한 id가 아니라 **draftId 스코프**로 삭제한다.
  // submit은 첨부를 application으로 재부모화(draftId→NULL, applicationId set)하므로, id 기준 삭제 시
  // 방금 제출된 application의 첨부 row를 오삭제할 수 있다. draftId 기준이면 재부모화된 행은 제외된다.
  await basePrisma.$transaction(async (tx) => {
    await tx.resumeFile.deleteMany({ where: { draftId: draft.id } });
    await tx.applicationDraft.delete({ where: { id: draft.id } });
  });

  // (3) 감사 — 파괴적 PII 삭제 추적성(개인정보보호법). PII-free metadata만(jobPostingId/파일수).
  await recordAuditEventSafe({
    eventType: AuditEventType.DRAFT_DISCARD,
    actorUserId: userId,
    resourceType: 'application_draft',
    resourceId: String(draft.id),
    ipAddress: null, // X-Forwarded-For 미신뢰 — withdraw 라우트와 일관
    userAgent: opts.userAgent ?? null,
    metadata: { jobPostingId, fileCount: files.length },
  });
}

