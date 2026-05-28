// CANDID-022 Step 2 — 회원 탈퇴 비즈니스 코어 (US-AUTH-005).
//
// 단일 트랜잭션 (BR-TX-01):
//   1) User row + applications count 조회 → 분기 결정
//   2) 분기 A — applications 존재 (활성/종결 무관):
//        users UPDATE (email rotate, name='탈퇴회원', PII NULL, passwordHash NULL,
//          status=WITHDRAWN, withdrawnAt + anonymizedAt = now, 로그인 카운터 리셋)
//        applications 보존 (PII snapshot은 BR-PII-04 1년 배치(CANDID-029)가 일괄 파기)
//        AuditLog × 2 (USER_WITHDRAWN + USER_ANONYMIZED)
//   3) 분기 B — applications 0건:
//        ResumeFile orphan(applicationId IS NULL AND draftId IS NULL) deleteMany — owner Restrict 우회
//        users DELETE — CASCADE: auth_providers / refresh_tokens / drafts /
//          email_verifications / password_reset_tokens / idempotency_keys
//        AuditLog × 2 (USER_WITHDRAWN + USER_HARD_DELETED) — actorUserId snapshot은 deletion 직전 capture
//
// 트랜잭션 외부 (BR-TX-02 — R-2 결정):
//   - revokeAllForUser(userId, 'user_withdrawn') — lib/auth/session.ts는 prisma 글로벌 사용으로
//     본 tx와 분리됨. anonymize 경로에선 user.passwordHash NULL + status WITHDRAWN이 이미 commit되어
//     동시 로그인 차단되었으므로 race 위험 낮음. hard delete 경로에선 refresh_tokens CASCADE로 즉시 삭제.
//   - revoke 호출 실패는 사용자 응답을 차단하지 않음 (이미 audit 기록됨).
//
// 보안 정책:
//   - passwordHash NOT NULL + passwordConfirmation 누락 → USER_PASSWORD_RECONFIRM_REQUIRED
//   - passwordHash NULL (소셜 전용) → USER_REAUTH_REQUIRED (MVP 차단, OAuth re-auth flow는 CANDID-022 FU1)
//   - passwordHash NOT NULL + verifyPassword 실패 → AUTH_INVALID_CREDENTIALS
//   - anonymizedAt NOT NULL or status === WITHDRAWN → USER_ALREADY_WITHDRAWN (멱등)
//
// 익명화 매트릭스 (R-2 가드):
//   email: withdrawn+{userId}+{rand8hex}@anonymized.invalid (UNIQUE 충돌 회피 + RFC 6761 .invalid TLD)
//   name: '탈퇴회원'
//   phone/birthDate: encryptUserPiiInput({phone: null, birthDate: null}) → NULL + keyVersion NULL
//   passwordHash: null (재로그인 차단)
//   status: WITHDRAWN
//   withdrawnAt / anonymizedAt: now()
//   failedLoginCount: 0, lockedUntil: null (감사 정합성 — 잠금 상태 잔존 방지)
//   *AgreedAt: 보존 (동의 이력은 감사 대상)

import 'server-only';
import { randomBytes } from 'node:crypto';
import { AuditEventType, type Prisma, UserStatus } from '@prisma/client';
import { prisma as wrappedPrisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { verifyPassword } from '@/lib/auth/password';
import { revokeAllForUser } from '@/lib/auth/session';
import type { WithdrawInput, WithdrawResult } from '@/lib/users/types';

// piiExtension이 적용된 wrappedPrisma의 $transaction 콜백 tx 타입 — D8 런타임 가드 유지.
type WithdrawTx = Parameters<Parameters<typeof wrappedPrisma.$transaction>[0]>[0];

/**
 * 익명화 이메일 생성기 — UNIQUE(email) 충돌 회피.
 *   withdrawn+{userId}+{rand8hex}@anonymized.invalid
 * - RFC 6761 `.invalid` TLD로 외부 발송/검증 차단
 * - userId + 8-byte random hex로 충돌 확률 무시 가능 (동일 사용자 재익명화는 USER_ALREADY_WITHDRAWN으로 차단)
 */
export function buildAnonymizedEmail(userId: number): string {
  const rand = randomBytes(8).toString('hex');
  return `withdrawn+${userId}+${rand}@anonymized.invalid`;
}

/**
 * AuditLog 1행 emit — metadataJson은 PII-free 키만 (count, length, mode).
 * 평문 reason/email/passwordHash는 절대 포함하지 않음 (BR-PII-02).
 */
async function emitAudit(
  tx: WithdrawTx,
  params: {
    userId: number;
    eventType: AuditEventType;
    metadata: Record<string, unknown>;
    userAgent: string | null;
    ipAddress: string | null;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorUserId: params.userId,
      eventType: params.eventType,
      resourceType: 'user',
      resourceId: String(params.userId),
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      metadataJson: params.metadata as Prisma.InputJsonValue,
    },
  });
}

/**
 * 익명화 경로 — applications 존재 시 (활성/종결 무관) User row 보존하면서 PII 제거.
 */
async function anonymizeUser(
  tx: WithdrawTx,
  params: {
    userId: number;
    now: Date;
    reasonLength: number;
    userAgent: string | null;
    ipAddress: string | null;
  },
): Promise<void> {
  // PII NULL 직접 설정 — encryptUserPiiInput은 입력 평문이 있을 때만 의미가 있고, null 경로는 컬럼 NULL을
  // 그대로 받는다. D8 런타임 가드(assertUserPiiInputShape)는 string 평문만 차단 — null/Buffer는 통과.
  await tx.user.update({
    where: { id: params.userId },
    data: {
      email: buildAnonymizedEmail(params.userId),
      name: '탈퇴회원',
      passwordHash: null,
      status: UserStatus.WITHDRAWN,
      withdrawnAt: params.now,
      anonymizedAt: params.now,
      failedLoginCount: 0,
      lockedUntil: null,
      phone: null,
      phoneKeyVersion: null,
      birthDate: null,
      birthDateKeyVersion: null,
    },
  });

  await emitAudit(tx, {
    userId: params.userId,
    eventType: AuditEventType.USER_WITHDRAWN,
    metadata: { reasonLength: params.reasonLength, mode: 'anonymized' },
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
  });
  await emitAudit(tx, {
    userId: params.userId,
    eventType: AuditEventType.USER_ANONYMIZED,
    metadata: { reasonLength: params.reasonLength },
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
  });
}

/**
 * 하드 삭제 경로 — applications 0건 시. ResumeFile orphan 사전 정리 후 User DELETE.
 * CASCADE 대상: auth_providers / refresh_tokens / application_drafts / email_verifications /
 *               password_reset_tokens / idempotency_keys.
 * RESTRICT 대상(applications)이 0건임을 호출자가 보장하므로 user.delete 안전.
 *
 * AuditLog는 user.delete 전에 actorUserId 박제로 INSERT — 삭제 후엔 actorUserId 의미 상실.
 */
async function hardDeleteUser(
  tx: WithdrawTx,
  params: {
    userId: number;
    reasonLength: number;
    userAgent: string | null;
    ipAddress: string | null;
  },
): Promise<void> {
  // owner=Restrict 충돌 회피: applications/drafts 미연결 ResumeFile만 (applications 0건은 호출자 보장).
  await tx.resumeFile.deleteMany({
    where: { ownerUserId: params.userId, applicationId: null, draftId: null },
  });

  // audit는 user.delete 이전에 INSERT — actorUserId가 user row와 무관(FK 미설정)이라 안전.
  await emitAudit(tx, {
    userId: params.userId,
    eventType: AuditEventType.USER_WITHDRAWN,
    metadata: { reasonLength: params.reasonLength, mode: 'hard_deleted' },
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
  });
  await emitAudit(tx, {
    userId: params.userId,
    eventType: AuditEventType.USER_HARD_DELETED,
    metadata: { reasonLength: params.reasonLength },
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
  });

  await tx.user.delete({ where: { id: params.userId } });
}

/**
 * 회원 탈퇴 진입점.
 *
 * 1) User 로딩 + 탈퇴 가능 상태 검증 (passwordHash / anonymizedAt / status)
 * 2) 비밀번호 재확인 (passwordHash 보유 시)
 * 3) 트랜잭션 진입 — applications count → 분기 → anonymize 또는 hardDelete
 * 4) 트랜잭션 외 — revokeAllForUser (anonymize 경로). hard_deleted 경로는 CASCADE로 자동 정리.
 *
 * @throws AppError USER_NOT_FOUND | USER_ALREADY_WITHDRAWN | USER_PASSWORD_RECONFIRM_REQUIRED |
 *                  USER_REAUTH_REQUIRED | AUTH_INVALID_CREDENTIALS
 */
export async function withdrawUser(input: WithdrawInput): Promise<WithdrawResult> {
  const now = new Date();
  const reasonLength = typeof input.reason === 'string' ? input.reason.length : 0;

  const user = await wrappedPrisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, passwordHash: true, anonymizedAt: true, status: true },
  });
  if (!user) {
    throw new AppError('USER_NOT_FOUND');
  }
  if (user.anonymizedAt !== null || user.status === UserStatus.WITHDRAWN) {
    throw new AppError('USER_ALREADY_WITHDRAWN');
  }

  if (user.passwordHash === null) {
    // 소셜 전용 사용자 — OAuth re-auth flow 미구현 (CANDID-022 FU1) → 차단.
    throw new AppError('USER_REAUTH_REQUIRED');
  }
  if (!input.passwordConfirmation) {
    throw new AppError('USER_PASSWORD_RECONFIRM_REQUIRED');
  }
  const passwordOk = await verifyPassword(input.passwordConfirmation, user.passwordHash);
  if (!passwordOk) {
    throw new AppError('AUTH_INVALID_CREDENTIALS');
  }

  const mode = await wrappedPrisma.$transaction(async (tx) => {
    const applicationCount = await tx.application.count({ where: { userId: input.userId } });
    const params = {
      userId: input.userId,
      reasonLength,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
    };
    if (applicationCount > 0) {
      // 활성(IN_PROGRESS)이든 종결이든 applications가 있으면 익명화 — applications.userId Restrict로
      // hard delete 불가하며, BR-PII-03이 채용 평가 기록 보존을 요구.
      await anonymizeUser(tx, { ...params, now });
      return 'anonymized' as const;
    }
    await hardDeleteUser(tx, params);
    return 'hard_deleted' as const;
  });

  // 트랜잭션 외부 — 활성 RefreshToken 일괄 revoke (BR-AUTH-05).
  // hard_deleted 경로는 CASCADE로 이미 삭제됨 — count 0 기대.
  let revokedSessionCount = 0;
  try {
    revokedSessionCount = await revokeAllForUser(input.userId, 'user_withdrawn');
  } catch {
    // revoke 실패는 사용자 응답을 차단하지 않음. 운영 모니터링 의존.
    revokedSessionCount = 0;
  }

  return {
    mode,
    userId: input.userId,
    revokedSessionCount,
    withdrawnAt: now,
  };
}
