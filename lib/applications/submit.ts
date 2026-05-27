// CANDID-018 Step 2 — 지원서 최종 제출 (US-APP-006).
//
// 단일 트랜잭션 (BR-TX-01):
//   1) application_number 발급 (UPDATE RETURNING atomic, L-024)
//   2) Application 생성 (PII snapshot 암호화 — encryptUserPiiInput 패턴)
//   3) ApplicationAnswer 일괄 생성 (Draft.payloadJson.step3_answers → answer rows)
//   4) resume_files / portfolio_links: draft_id → application_id 이전 (XOR 보존)
//   5) ApplicationDraft 삭제
//   6) ApplicationStatusHistory(from=NULL, to=SUBMITTED) 생성
//
// 트랜잭션 외부 (BR-TX-02):
//   - 확인 이메일 fire-and-forget (실패해도 응답 정상)
//
// P2002 매핑 (L-030 target 검증):
//   - applications.application_number race → 재시도 (issueApplicationNumber 자체 처리)
//   - (user_id, job_posting_id) partial UNIQUE 충돌 → APP_ALREADY_SUBMITTED
//   - 그 외 P2002 → 원본 throw

import 'server-only';
import { Prisma, StageType } from '@prisma/client';
import { basePrisma, prisma as wrappedPrisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { encryptUserPiiInput } from '@/lib/prisma/extends';
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
 * Buffer → Uint8Array<ArrayBuffer> 변환. Prisma Bytes 컬럼이 요구하는 generic을 만족.
 * Buffer는 Uint8Array의 subclass이지만 @types/node v22+ 환경에서 generic이 ArrayBufferLike로
 * 넓어져 Prisma의 Uint8Array<ArrayBuffer> 매개변수와 호환되지 않는다 — 캐스팅으로 해소.
 */
function toBytes(value: Uint8Array | null | undefined): Uint8Array<ArrayBuffer> | null {
  if (value === null || value === undefined) return null;
  return value as unknown as Uint8Array<ArrayBuffer>;
}

/**
 * 지원서 최종 제출 (단일 트랜잭션).
 *
 * - 트랜잭션 외부에서 검증 (assertSubmitReady) → fail-fast로 트랜잭션 외 자원 절약
 * - PII snapshot은 piiExtension wrapped `prisma`를 사용하면 자동 암호화되지만
 *   본 함수는 명시적으로 `encryptUserPiiInput`을 호출하여 트랜잭션 client에서도 동일 동작 보장
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

  // User PII snapshot 준비 — wrapped prisma로 자동 복호화 (Application.create 호출 전에 평문 확보)
  const userPii = await wrappedPrisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      name: true,
      phone: true,
      birthDate: true,
    },
  });
  if (userPii === null) {
    throw new AppError('USER_NOT_FOUND');
  }

  // PII snapshot 암호화 (Application 컬럼별 ciphertext + key_version)
  // CANDID-008 패턴 미러 — Application 모델에 piiExtension hook이 없으므로 명시 암호화.
  const piiEncrypted = encryptUserPiiInput({
    phone: userPii.phone ?? undefined,
    birthDate: userPii.birthDate ?? undefined,
  });
  const nameEncrypted =
    userPii.name.length > 0
      ? encryptUserPiiInput({ phone: userPii.name }) // name 컬럼은 phone과 동일 ciphertext 구조 — applicantNameSnapshot
      : { phone: undefined, phoneKeyVersion: undefined };
  const emailEncrypted = encryptUserPiiInput({ phone: userPii.email });

  // 2) 트랜잭션
  let applicationNumber: string;
  let submittedAt: Date;
  try {
    const result = await basePrisma.$transaction(async (tx) => {
      const num = await issueApplicationNumber(now, tx);

      const created = await tx.application.create({
        data: {
          applicationNumber: num.value,
          userId,
          jobPostingId,
          currentStage: StageType.SUBMITTED,
          submittedAt: now,
          // PII snapshot (BR-PII-03) — encryptUserPiiInput는 Buffer 반환, Prisma Bytes는
          // Uint8Array<ArrayBuffer> 수락. Buffer<ArrayBufferLike> generic 불일치는 더블 캐스트로 해소.
          applicantNameSnapshot: toBytes(nameEncrypted.phone),
          applicantNameSnapshotKeyVersion: nameEncrypted.phoneKeyVersion ?? null,
          applicantEmailSnapshot: toBytes(emailEncrypted.phone),
          applicantEmailSnapshotKeyVersion: emailEncrypted.phoneKeyVersion ?? null,
          phoneSnapshot: toBytes(piiEncrypted.phone),
          phoneSnapshotKeyVersion: piiEncrypted.phoneKeyVersion ?? null,
          birthDateSnapshot: toBytes(piiEncrypted.birthDate),
          birthDateSnapshotKeyVersion: piiEncrypted.birthDateKeyVersion ?? null,
        },
        select: { id: true, applicationNumber: true, submittedAt: true },
      });

      // 3) ApplicationAnswer 일괄 생성 (Draft.step3_answers → rows)
      const answerRows = extractAnswerRows(payload, created.id);
      if (answerRows.length > 0) {
        await tx.applicationAnswer.createMany({ data: answerRows });
      }

      // 4) resume_files / portfolio_links draft_id → application_id 이전 (XOR 만족)
      await tx.resumeFile.updateMany({
        where: { draftId, applicationId: null },
        data: { applicationId: created.id, draftId: null },
      });
      await tx.portfolioLink.updateMany({
        where: { draftId, applicationId: null },
        data: { applicationId: created.id, draftId: null },
      });

      // 5) Draft 삭제
      await tx.applicationDraft.delete({ where: { id: draftId } });

      // 6) StatusHistory 신규 (from=NULL, to=SUBMITTED)
      await tx.applicationStatusHistory.create({
        data: {
          applicationId: created.id,
          fromStage: null,
          toStage: StageType.SUBMITTED,
          changedByUserId: null, // 시스템 자동 변경
        },
      });

      return created;
    });
    applicationNumber = result.applicationNumber;
    submittedAt = result.submittedAt;
  } catch (err) {
    throw mapSubmitError(err);
  }

  // 7) 트랜잭션 외부 — 확인 이메일 fire-and-forget (BR-TX-02)
  if (userPii.email) {
    void sendMail(
      buildApplicationConfirmMessage({
        to: userPii.email,
        name: userPii.name,
        applicationNumber,
      }),
    ).catch(() => undefined);
  }

  return {
    applicationNumber,
    submittedAt: submittedAt.toISOString(),
    currentStage: 'SUBMITTED',
  };
}

/**
 * Prisma 예외를 도메인 에러로 매핑 (L-030 target 검증).
 *   - applications partial UNIQUE 충돌 → APP_ALREADY_SUBMITTED
 *   - applications.application_number 충돌 → 재시도 한계 초과 (number-generator 자체 처리됨, 여기까지 오면 예외)
 *   - 그 외 → 원본 그대로
 */
function mapSubmitError(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = err.meta?.target;
    const targetStr = Array.isArray(target) ? target.join(',') : String(target ?? '');
    // partial UNIQUE 인덱스명 (CANDID-005 migration.sql)
    if (
      targetStr.includes('applications_user_posting_active_unique') ||
      targetStr.includes('user_id') ||
      targetStr.includes('uk_applications_active')
    ) {
      return new AppError('APP_ALREADY_SUBMITTED');
    }
    if (targetStr.includes('application_number')) {
      // number-generator가 3회 재시도해도 race 폭주 시 — 일시적 의존성 장애로 매핑
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
 *   - 그 외 (number/object) → skip (zod 단계에서 차단되어야 함)
 */
function extractAnswerRows(payload: DraftPayloadV1, applicationId: number): AnswerRow[] {
  const answers = payload.step3_answers;
  if (answers === undefined || answers === null) return [];
  const rows: AnswerRow[] = [];
  for (const [key, value] of Object.entries(answers)) {
    const questionId = Number(key);
    if (!Number.isInteger(questionId) || questionId <= 0) continue;
    if (typeof value === 'string') {
      rows.push({
        applicationId,
        questionId,
        answerText: value,
        answerOptionsJson: undefined,
      });
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
