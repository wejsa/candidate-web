import 'server-only';
import { AuditEventType, Prisma, UserRole, UserStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { recordAuditEvent } from '@/lib/audit/record';

// CANDID-053 Step 3 — 운영자 역할 관리 (US-AUTH / RBAC, A안).
//
// 불변식:
//   - 본인 역할 변경 금지(USER_CANNOT_CHANGE_OWN_ROLE) — 자가 강등 락아웃·자가 권한 조정 차단.
//   - 마지막 ADMIN 강등 금지(USER_LAST_ADMIN) — 운영 권한 공백 방지.
//     2테이블 아님(단일 users 집계)이나 TOCTOU(동시 두 ADMIN 강등 → 0명) 차단을 위해
//     **활성 ADMIN 행 전체를 FOR UPDATE로 잠그고 잠금 후 카운트**한다(db-designer 권고).
//   - role 변경 + 감사(ROLE_GRANTED/REVOKED)는 단일 트랜잭션(BR-TX-01) — 감사 누락 없는 원자적 전이.
//
// ⚠️ ordinal enum 비교 금지(M001) — 승격/강등 판정은 명시 RANK 맵으로.

const ROLE_RANK: Record<UserRole, number> = { CANDIDATE: 0, RECRUITER: 1, ADMIN: 2 };

export interface ChangeRoleInput {
  actorUserId: number;
  targetUserId: number;
  newRole: UserRole;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface ChangeRoleResult {
  userId: number;
  previousRole: UserRole;
  role: UserRole;
  changed: boolean;
}

export async function changeUserRole(input: ChangeRoleInput): Promise<ChangeRoleResult> {
  const { actorUserId, targetUserId, newRole } = input;

  // 본인 역할 변경 차단 — 트랜잭션 진입 전 fail-fast.
  if (actorUserId === targetUserId) {
    throw new AppError('USER_CANNOT_CHANGE_OWN_ROLE');
  }

  return prisma.$transaction(
    async (tx) => {
      // 대상 행 잠금 — 동일 대상 동시 변경 직렬화. id만 SELECT(PII 미접근).
      // eslint-disable-next-line no-restricted-syntax -- FOR UPDATE 잠금 전용, PII 컬럼 미선택 (db-designer CRITICAL 가드)
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${targetUserId} FOR UPDATE`;

      const target = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { role: true, status: true },
      });
      if (target === null || target.status === UserStatus.WITHDRAWN) {
        throw new AppError('USER_NOT_FOUND');
      }

      const previousRole = target.role;
      if (previousRole === newRole) {
        // 멱등 — 변경/감사 없음.
        return { userId: targetUserId, previousRole, role: newRole, changed: false };
      }

      // 마지막 ADMIN 강등 차단: 활성 ADMIN 전체를 잠그고(동시 강등 직렬화) 대상 외 ADMIN 수를 센다.
      if (previousRole === UserRole.ADMIN && newRole !== UserRole.ADMIN) {
        // eslint-disable-next-line no-restricted-syntax -- FOR UPDATE 잠금 전용, PII 컬럼 미선택
        const admins = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' FOR UPDATE
        `;
        const otherActiveAdmins = admins.filter((a) => Number(a.id) !== targetUserId).length;
        if (otherActiveAdmins < 1) {
          throw new AppError('USER_LAST_ADMIN');
        }
      }

      await tx.user.update({ where: { id: targetUserId }, data: { role: newRole } });

      const eventType =
        ROLE_RANK[newRole] > ROLE_RANK[previousRole]
          ? AuditEventType.ROLE_GRANTED
          : AuditEventType.ROLE_REVOKED;

      // 감사 in-tx(BR-TX-01) — role 변경과 원자적. metadata PII-free(role 명만).
      await recordAuditEvent(
        {
          eventType,
          actorUserId,
          resourceType: 'user',
          resourceId: String(targetUserId),
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          metadata: { from: previousRole, to: newRole },
        },
        { tx },
      );

      return { userId: targetUserId, previousRole, role: newRole, changed: true };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
