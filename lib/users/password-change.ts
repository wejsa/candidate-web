import 'server-only';
import { AuditEventType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { recordAuditEvent } from '@/lib/audit/record';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

// CANDID-024 Step 3 — 비밀번호 변경 서비스 (US-MY-004, POST /api/v1/users/me/password).
//
// 보안 규칙:
//   - 비번 보유 사용자: currentPassword 재확인 필수(불일치 → AUTH_INVALID_CREDENTIALS).
//   - 소셜 전용(passwordHash NULL): 최초 설정(set) 모드 — currentPassword 불요.
//   - hashPassword(BCrypt strength 12)는 트랜잭션 밖에서 수행(CPU 비용 — DB 커넥션 점유 회피).
//   - 단일 트랜잭션: password_hash 갱신 + 전체 refresh_token revoke(BR-AUTH-05) + PASSWORD_CHANGE 감사 로그.
//     revoke를 tx 밖으로 빼면 "비번 변경됐는데 옛 토큰 유효" 윈도우가 생기므로 동일 tx에서 처리.
//   - 평문 비밀번호는 감사 로그/응답/예외 어디에도 기록하지 않는다 (BR-PII-02).

export interface ChangePasswordInput {
  userId: number;
  /** 비번 보유 사용자 재확인용. 소셜 전용 최초 설정 시 undefined/null. */
  currentPassword?: string | null;
  newPassword: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface ChangePasswordResult {
  /** 'changed' = 기존 비번 교체, 'set' = 소셜 전용 계정 최초 설정. */
  mode: 'changed' | 'set';
  /** revoke된 활성 refresh 세션 수. */
  revokedSessionCount: number;
}

export async function changePassword(input: ChangePasswordInput): Promise<ChangePasswordResult> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, passwordHash: true, status: true },
  });
  if (user === null || user.status === 'WITHDRAWN') {
    throw new AppError('USER_NOT_FOUND');
  }

  const hasExisting = user.passwordHash !== null;
  if (hasExisting) {
    if (
      input.currentPassword === undefined ||
      input.currentPassword === null ||
      input.currentPassword === ''
    ) {
      // 비번 보유 사용자가 현재 비번을 제시하지 않음 → 재확인 요구.
      throw new AppError('USER_PASSWORD_RECONFIRM_REQUIRED');
    }
    const matches = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!matches) {
      throw new AppError('AUTH_INVALID_CREDENTIALS');
    }
  }

  // 트랜잭션 밖 해싱 (BCrypt 12 — CPU 무거움).
  const newHash = await hashPassword(input.newPassword);
  const mode: 'changed' | 'set' = hasExisting ? 'changed' : 'set';
  const now = new Date();

  const revokedSessionCount = await prisma.$transaction(async (tx) => {
    // 1) 비번 갱신 — status≠WITHDRAWN 가드로 진입 검사~tx 사이 race(동시 탈퇴) 차단.
    const updated = await tx.user.updateMany({
      where: { id: input.userId, NOT: { status: 'WITHDRAWN' } },
      data: { passwordHash: newHash },
    });
    if (updated.count === 0) {
      throw new AppError('USER_NOT_FOUND');
    }

    // 2) 전체 refresh 토큰 revoke (BR-AUTH-05) — 동일 tx로 유효 윈도우 제거.
    // SSOT 주의: lib/auth/session.ts revokeAllForUser(userId, 'password_change')와 동일 시맨틱이나,
    // 그 헬퍼는 글로벌 prisma를 사용해 본 트랜잭션 컨텍스트를 공유할 수 없어 인라인 재현한다.
    // revoke 조건(revokedAt=null 필터 / reason)을 바꿀 때는 두 곳을 함께 갱신해야 BR-AUTH-05 일관성 유지.
    const revoked = await tx.refreshToken.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: 'password_change' },
    });

    // 3) 감사 로그 — 평문 비밀번호 비포함 (mode만 기록). emit SSOT 경유(traceId 자동 첨부).
    await recordAuditEvent(
      {
        eventType: AuditEventType.PASSWORD_CHANGE,
        actorUserId: input.userId,
        resourceType: 'user',
        resourceId: String(input.userId),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        metadata: { mode },
      },
      { tx },
    );

    return revoked.count;
  });

  return { mode, revokedSessionCount };
}
