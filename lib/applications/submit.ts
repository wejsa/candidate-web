// CANDID-018 Step 2 — 지원서 최종 제출 (US-APP-006).
//
// 단일 트랜잭션 (BR-TX-01):
//   1) application_number 발급 (tx 외부 사전 발급 — sequence lock 시간 최소화)
//   2) Application 생성 (PII snapshot encryptApplicationPiiSnapshotInput 5개 컬럼)
//   3) ApplicationAnswer 일괄 생성 (Draft.payloadJson.step3_answers → answer rows)
//   4) resume_files / portfolio_links: draft_id → application_id 이전 (XOR 보존)
//   5) ApplicationDraft 삭제
//   6) ApplicationStatusHistory(from=NULL, to=SUBMITTED, changedByUserId=userId) 생성
//
// L-019 in-task self-correction (PR #68 review fix loop 1):
//   - C001 fix (도메인+보안): encryptUserPiiInput({phone: name}) 오용 → 전용 헬퍼
//     encryptApplicationPiiSnapshotInput으로 교체. normalizePhone이 비-숫자 input에 throw로
//     모든 제출 100% 실패하던 회귀를 차단.
//   - C002 fix (보안): basePrisma.$transaction → wrappedPrisma.$transaction.
//     applicationPiiExtension D8 런타임 가드를 tx 내부에도 적용 (L-006 3-layer 마지막 방어선).
//   - D-H001 fix (TOCTOU): tx 내부 마감 재검증으로 BR-APP-04 strong guarantee.
//   - D-H002 fix (mapSubmitError): user_id substring → 인덱스명 화이트리스트 SSOT.
//   - D-H006 fix (감사): changedByUserId=userId (시스템 vs 본인 actor 구분).
//
// 트랜잭션 외부 (BR-TX-02):
//   - 확인 이메일 fire-and-forget + 로깅 (실패해도 응답 정상)

import 'server-only';
import { AuditEventType, Prisma, StageType, JobStatus } from '@prisma/client';
import { prisma as wrappedPrisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { recordAuditEvent } from '@/lib/audit/record';
import { encryptApplicationPiiSnapshotInput } from '@/lib/prisma/extends';
import { issueApplicationNumber } from '@/lib/applications/number-generator';
import { assertSubmitReady } from '@/lib/applications/validate';
import type { SubmittedApplicationSummary } from '@/lib/applications/types';
import type { DraftPayloadV1 } from '@/lib/drafts/types';
import { sendMail } from '@/lib/email/transport';
import { buildApplicationConfirmMessage } from '@/lib/email/templates/application-confirm';

interface SubmitInput {
  userId: number;
  jobPostingId: number;
  now?: Date;
}

/**
 * Buffer → Uint8Array<ArrayBuffer> 변환. Prisma Bytes 컬럼 generic 호환.
 * @types/node v22+ generic이 ArrayBufferLike로 넓어져 Prisma의 Uint8Array<ArrayBuffer>와 충돌.
 */
function toBytes(value: Uint8Array | null | undefined): Uint8Array<ArrayBuffer> | null {
  if (value === null || value === undefined) return null;
  return value as unknown as Uint8Array<ArrayBuffer>;
}

/**
 * P2002 매핑 화이트리스트 SSOT (D-H002 fix — L-030 정확한 인덱스명 매칭).
 */
const ACTIVE_APP_UNIQUE_INDEXES = new Set([
  'uk_applications_active',
  'applications_user_posting_active_unique',
]);
const APP_NUMBER_UNIQUE_INDEXES = new Set([
  'application_number',
  'applications_application_number_key',
]);

/**
 * 지원서 최종 제출 (단일 트랜잭션).
 *
 * - 트랜잭션 외 검증 (assertSubmitReady) → fail-fast로 트랜잭션 자원 절약
 * - PII snapshot은 전용 헬퍼 encryptApplicationPiiSnapshotInput 사용 — 필드별 정규화 적용
 * - wrapped prisma 트랜잭션으로 applicationPiiExtension D8 런타임 가드 유지
 * - 트랜잭션 commit 후 이메일 fire-and-forget — 실패해도 응답 정상 (BR-TX-02)
 *
 * @returns 응답 본문 (PII-free: applicationNumber + submittedAt + currentStage)
 */
export async function submitApplication({
  userId,
  jobPostingId,
  now = new Date(),
}: SubmitInput): Promise<SubmittedApplicationSummary> {
  // 1) 트랜잭션 외 검증 (fail-fast)
  const { draftId, payload } = await assertSubmitReady({ userId, jobPostingId, now });

  // User PII snapshot 준비 — wrapped prisma로 자동 복호화
  const userPii = await wrappedPrisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, phone: true, birthDate: true },
  });
  if (userPii === null) {
    throw new AppError('USER_NOT_FOUND');
  }

  // C001 fix: 전용 헬퍼 사용 — 각 필드별 normalizeName/Email/Phone/BirthDate 적용
  const snapshot = encryptApplicationPiiSnapshotInput({
    applicantNameSnapshot: userPii.name,
    applicantEmailSnapshot: userPii.email,
    phoneSnapshot: userPii.phone,
    birthDateSnapshot: userPii.birthDate,
  });

  // 2) application_number 외부 발급 (sequence lock 시간 최소화)
  const num = await issueApplicationNumber(now);

  // 3) 트랜잭션 (C002 fix: wrapped prisma로 D8 가드 유지)
  let applicationNumber: string;
  let submittedAt: Date;
  try {
    const result = await wrappedPrisma.$transaction(async (tx) => {
      // D-H001 fix: tx 내부 마감 재검증 (BR-APP-04 strong guarantee — TOCTOU 윈도우 차단)
      const jobRecheck = await tx.jobPosting.findUnique({
        where: { id: jobPostingId },
        select: { status: true, closesAt: true },
      });
      if (jobRecheck === null || jobRecheck.status !== JobStatus.OPEN) {
        throw new AppError('JOB_NOT_FOUND');
      }
      if (jobRecheck.closesAt !== null && jobRecheck.closesAt.getTime() <= now.getTime()) {
        throw new AppError('APP_DEADLINE_PASSED');
      }

      const created = await tx.application.create({
        data: {
          applicationNumber: num.value,
          userId,
          jobPostingId,
          currentStage: StageType.SUBMITTED,
          submittedAt: now,
          // PII snapshot (BR-PII-03) — 전용 헬퍼 결과 + toBytes 캐스팅
          applicantNameSnapshot: toBytes(snapshot.applicantNameSnapshot),
          applicantNameSnapshotKeyVersion: snapshot.applicantNameSnapshotKeyVersion ?? null,
          applicantEmailSnapshot: toBytes(snapshot.applicantEmailSnapshot),
          applicantEmailSnapshotKeyVersion: snapshot.applicantEmailSnapshotKeyVersion ?? null,
          phoneSnapshot: toBytes(snapshot.phoneSnapshot),
          phoneSnapshotKeyVersion: snapshot.phoneSnapshotKeyVersion ?? null,
          birthDateSnapshot: toBytes(snapshot.birthDateSnapshot),
          birthDateSnapshotKeyVersion: snapshot.birthDateSnapshotKeyVersion ?? null,
        },
        select: { id: true, applicationNumber: true, submittedAt: true },
      });

      // 4) ApplicationAnswer 일괄 생성
      const answerRows = extractAnswerRows(payload, created.id);
      if (answerRows.length > 0) {
        await tx.applicationAnswer.createMany({ data: answerRows });
      }

      // 5) resume_files / portfolio_links 이전 (XOR 보존)
      await tx.resumeFile.updateMany({
        where: { draftId, applicationId: null },
        data: { applicationId: created.id, draftId: null },
      });
      await tx.portfolioLink.updateMany({
        where: { draftId, applicationId: null },
        data: { applicationId: created.id, draftId: null },
      });

      // 6) Draft 삭제
      await tx.applicationDraft.delete({ where: { id: draftId } });

      // 7) StatusHistory — D-H006 fix: 본인 actor 기록
      await tx.applicationStatusHistory.create({
        data: {
          applicationId: created.id,
          fromStage: null,
          toStage: StageType.SUBMITTED,
          changedByUserId: userId,
        },
      });

      // 8) 감사 로그 — APPLICATION_SUBMIT (CANDID-026 Step 3). BR-TX-01: 단일 트랜잭션 내 기록.
      //    metadata는 PII-free(applicationNumber만). traceId는 ALS 컨텍스트에서 자동 첨부.
      await recordAuditEvent(
        {
          eventType: AuditEventType.APPLICATION_SUBMIT,
          actorUserId: userId,
          resourceType: 'application',
          resourceId: String(created.id),
          metadata: { applicationNumber: created.applicationNumber },
        },
        { tx },
      );

      return created;
    });
    applicationNumber = result.applicationNumber;
    submittedAt = result.submittedAt;
  } catch (err) {
    throw mapSubmitError(err);
  }

  // 8) 트랜잭션 외 — 확인 이메일 fire-and-forget + 로깅 (BR-TX-02)
  if (userPii.email) {
    void sendMail(
      buildApplicationConfirmMessage({
        to: userPii.email,
        name: userPii.name,
        applicationNumber,
      }),
    ).catch((err) => {
      // PII 금지: email/name 로깅 X. applicationNumber만 안전.
      console.warn(
        `[application-confirm-mail-failed] applicationNumber=${applicationNumber} err=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  return {
    applicationNumber,
    submittedAt: submittedAt.toISOString(),
    currentStage: 'SUBMITTED',
  };
}

/**
 * Prisma P2002 → 도메인 에러 매핑 (L-030 인덱스명 정확 매칭).
 */
function mapSubmitError(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = err.meta?.target;
    const targets = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
    if (targets.some((t) => ACTIVE_APP_UNIQUE_INDEXES.has(t))) {
      return new AppError('APP_ALREADY_SUBMITTED');
    }
    if (targets.some((t) => APP_NUMBER_UNIQUE_INDEXES.has(t))) {
      return new AppError('SYS_DEPENDENCY_UNAVAILABLE');
    }
  }
  return err;
}

interface AnswerRow {
  applicationId: number;
  questionId: number;
  answerText: string | null;
  answerOptionsJson: Prisma.InputJsonValue | undefined;
}

/**
 * Draft.payload.step3_answers를 ApplicationAnswer row 배열로 변환.
 * 형식: `step3_answers: { [questionId: string]: string | string[] }`
 *   - string → answerText
 *   - string[] → answerOptionsJson
 *   - 그 외 (number/object/invalid key) → silent skip
 *     (zod 단계 + DB FK가 1차 방어, 본 함수는 2차 silent skip)
 */
function extractAnswerRows(payload: DraftPayloadV1, applicationId: number): AnswerRow[] {
  const answers = payload.step3_answers;
  if (answers === undefined || answers === null) return [];
  const rows: AnswerRow[] = [];
  for (const [key, value] of Object.entries(answers)) {
    const questionId = Number(key);
    if (!Number.isInteger(questionId) || questionId <= 0) continue;
    if (typeof value === 'string') {
      rows.push({ applicationId, questionId, answerText: value, answerOptionsJson: undefined });
    } else if (Array.isArray(value)) {
      rows.push({
        applicationId,
        questionId,
        answerText: null,
        answerOptionsJson: value as Prisma.InputJsonValue,
      });
    }
  }
  return rows;
}
