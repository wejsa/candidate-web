// CANDID-018 Step 2 — 제출 전 검증 (US-APP-006).
//
// 검증 항목 (BR-AUTH-04 / BR-APP-03/04 / BR-FILE-* / spec §US-APP-006):
//   1. 이메일 인증 완료 (emailVerifiedAt IS NOT NULL)
//   2. Draft 존재 + ownership (APP_DRAFT_NOT_FOUND 정보 누출 차단)
//   3. 공고 OPEN 상태 + 마감 재검증 (closes_at > now)
//   4. 이력서 1+ 업로드 (active resume_files, deletedAt IS NULL 가정 — CANDID-016)
//   5. payload step1_personal 완성도 (name/phone/birthDate)

import 'server-only';
import { JobStatus, type Prisma } from '@prisma/client';
import { basePrisma } from '@/lib/prisma';
import { AppError, type ErrorDetail } from '@/lib/errors';
import type { DraftPayloadV1, PersonalInfoPayload } from '@/lib/drafts/types';

type PrismaLike = typeof basePrisma | Prisma.TransactionClient;

export interface SubmitReadyInput {
  userId: number;
  jobPostingId: number;
  now?: Date;
}

export interface SubmitReadyContext {
  /** Draft 행의 id (submit.ts에서 application 생성 시 사용). */
  draftId: number;
  /** Draft.payloadJson을 검증된 형태로 반환. */
  payload: DraftPayloadV1;
}

/**
 * 제출 전 종합 검증. 실패 시 AppError throw:
 *   - AUTH_EMAIL_NOT_VERIFIED (403): 이메일 미인증
 *   - APP_DRAFT_NOT_FOUND (404): Draft 없음 / 권한 없음
 *   - JOB_NOT_FOUND (404): 공고 미존재 또는 DRAFT 상태
 *   - JOB_CLOSED (422): closes_at <= now (마감 재검증, BR-APP-04)
 *   - APP_SUBMIT_INCOMPLETE (422): 이력서 누락 또는 필수 필드 미충족 (details에 항목 명시)
 *
 * 트랜잭션 외부에서 호출 권장 (fail-fast). client 인자로 tx 전달 시 트랜잭션 내부에서도 동작.
 */
export async function assertSubmitReady(
  { userId, jobPostingId, now = new Date() }: SubmitReadyInput,
  client: PrismaLike = basePrisma,
): Promise<SubmitReadyContext> {
  // 1) User + email 인증 확인
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true },
  });
  if (user === null) {
    // requireAuth 통과 후 미발생 — defense-in-depth
    throw new AppError('USER_NOT_FOUND');
  }
  if (user.emailVerifiedAt === null) {
    throw new AppError('AUTH_EMAIL_NOT_VERIFIED');
  }

  // 2) 공고 OPEN + 마감 재검증 (BR-APP-04)
  const job = await client.jobPosting.findUnique({
    where: { id: jobPostingId },
    select: { id: true, status: true, closesAt: true },
  });
  if (job === null || job.status === JobStatus.DRAFT) {
    throw new AppError('JOB_NOT_FOUND');
  }
  if (job.status === JobStatus.CLOSED) {
    throw new AppError('JOB_CLOSED');
  }
  if (job.closesAt !== null && job.closesAt.getTime() <= now.getTime()) {
    // BR-APP-04: 작성 중 마감되는 케이스 방어
    throw new AppError('APP_DEADLINE_PASSED');
  }

  // 3) Draft + ownership 검사 (APP_DRAFT_NOT_FOUND로 정보 누출 차단)
  const draft = await client.applicationDraft.findUnique({
    where: { userId_jobPostingId: { userId, jobPostingId } },
    select: { id: true, payloadJson: true },
  });
  if (draft === null) {
    throw new AppError('APP_DRAFT_NOT_FOUND');
  }
  const payload = draft.payloadJson as unknown as DraftPayloadV1;

  // 4) 이력서 1+ 업로드 (draft_id 기준)
  const resumeCount = await client.resumeFile.count({
    where: { draftId: draft.id, applicationId: null },
  });

  // 5) payload 필수 필드 검증
  const incompleteReasons = collectIncompleteReasons(payload, resumeCount);
  if (incompleteReasons.length > 0) {
    throw new AppError('APP_SUBMIT_INCOMPLETE', {
      message: '지원서 제출 조건이 충족되지 않았습니다.',
      details: incompleteReasons,
    });
  }

  return { draftId: draft.id, payload };
}

/**
 * payload + resumeCount 기준 미충족 사유 수집.
 * 빈 배열이면 제출 가능.
 */
export function collectIncompleteReasons(
  payload: DraftPayloadV1 | null,
  resumeCount: number,
): ErrorDetail[] {
  const reasons: ErrorDetail[] = [];
  if (resumeCount < 1) {
    reasons.push({ field: 'resumeFile', reason: '이력서 파일이 1개 이상 필요합니다.' });
  }
  const personal = payload?.step1_personal;
  if (!isCompletedPersonalInfo(personal)) {
    reasons.push({
      field: 'step1_personal',
      reason: '이름·연락처·생년월일 등 인적사항 필수 항목을 입력해 주세요.',
    });
  }
  return reasons;
}

/**
 * step1_personal 필수 필드 충족 검사 — name/phone/birthDate/careerLevel.
 * address/careerMonths/education은 선택.
 */
function isCompletedPersonalInfo(
  personal: PersonalInfoPayload | undefined,
): personal is PersonalInfoPayload {
  if (personal === undefined) return false;
  if (!isNonEmptyString(personal.name)) return false;
  if (!isNonEmptyString(personal.phone)) return false;
  if (!isNonEmptyString(personal.birthDate)) return false;
  if (personal.careerLevel !== 'NEW' && personal.careerLevel !== 'EXPERIENCED') return false;
  return true;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
