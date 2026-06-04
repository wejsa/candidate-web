import 'server-only';
import type { NextRequest } from 'next/server';
import { UserStatus, type UserRole } from '@prisma/client';
import { requireAuth, type AuthContext } from '@/lib/auth/middleware';
import { basePrisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';

// CANDID-053 Step 2 — 역할 인가 헬퍼 (A안 RBAC).
//
// requireRole은 requireAuth(인증 — jose 검증, Edge 호환) 통과 후 **DB에서 role을 재조회**한다.
//   - 권한 SSOT는 DB의 users.role 컬럼 — 토큰 클레임이 아니다. 즉시 강등이 반영되고, 토큰 위·변조로
//     권한을 올릴 수 없다(escalation 차단).
//   - 본 모듈은 basePrisma(server-only)를 import하므로 **Node 런타임 전용**. Edge 호환이 필요한
//     requireAuth는 middleware.ts에 그대로 두어 분리한다(prisma 미반입).
//
// 인가 판정:
//   - 토큰 유효하나 계정 부재/비활성(탈퇴·잠금) → AUTH_FORBIDDEN (운영자 자격 박탈 방어선)
//   - role이 allow-list에 없음 → AUTH_FORBIDDEN
//
// ⚠️ enum **순서(ordinal) 비교 금지**(리뷰 M001) — `allowed.includes(role)` 명시적 집합 포함만 사용.
//    향후 INTERVIEWER 등 enum 중간 삽입 시에도 권한 경계가 silent하게 깨지지 않는다.

export interface AuthRoleContext extends AuthContext {
  role: UserRole;
}

export async function requireRole(
  request: NextRequest,
  ...allowed: UserRole[]
): Promise<AuthRoleContext> {
  const { userId } = await requireAuth(request);

  const user = await basePrisma.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  });

  // 토큰은 유효하나 계정이 사라졌거나(탈퇴/익명화) ACTIVE가 아님(잠금) → 운영 권한 거부.
  if (user === null || user.status !== UserStatus.ACTIVE) {
    throw new AppError('AUTH_FORBIDDEN');
  }
  if (!allowed.includes(user.role)) {
    throw new AppError('AUTH_FORBIDDEN');
  }

  return { userId, role: user.role };
}
