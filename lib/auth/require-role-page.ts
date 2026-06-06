import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { UserRole, UserStatus } from '@prisma/client';
import { getOptionalAuthFromCookies } from '@/lib/auth/server-cookies';
import { basePrisma } from '@/lib/prisma';

// CANDID-053 Step 8 — 백오피스 페이지(RSC) 전용 역할 가드 (A안 RBAC).
//
// requireRole(lib/auth/require-role.ts)은 Route Handler용으로 NextRequest를 받아 AppError를 throw한다.
// RSC 페이지/레이아웃은 NextRequest가 없고 throw 대신 navigation 제어(redirect/notFound)가 필요하므로
// 본 헬퍼를 분리한다. 인가 SSOT는 동일 — **DB의 users.role 재조회**(토큰 클레임 불신, 즉시 강등 반영).
//
// 보안 경계 원칙(Next.js): 레이아웃 가드만 신뢰하지 말 것. 레이아웃은 네비게이션 간 재실행이 보장되지
// 않으므로, 각 백오피스 페이지가 데이터 접근 직전에 본 가드를 **개별 호출**한다(defense-in-depth).
//
// 미인증 → 로그인으로 redirect(복귀 경로 보존). 인증되었으나 비운영자/비활성 → notFound(404):
//   후보자에게 백오피스 존재 자체를 노출하지 않는다(403 대신 404 — 정보 은닉).

/** 백오피스 접근 허용 역할 — 명시적 집합(enum ordinal 비교 금지, require-role.ts와 동일 원칙). */
const OPERATOR_ROLES: readonly UserRole[] = [UserRole.RECRUITER, UserRole.ADMIN];

export interface OperatorPageContext {
  userId: number;
  role: UserRole;
}

/**
 * 백오피스 페이지 진입 가드. 운영자(RECRUITER/ADMIN)면 컨텍스트를 반환하고, 아니면 흐름을 끊는다.
 * @param returnTo 미인증 redirect 시 로그인 후 복귀할 경로(기본 현재 백오피스 홈).
 */
export async function requireOperatorPage(returnTo = '/admin'): Promise<OperatorPageContext> {
  const auth = await getOptionalAuthFromCookies();
  if (auth === null) {
    // redirect()는 never를 반환(throw)하므로 이후 auth는 non-null로 좁혀진다.
    redirect(`/login?redirect=${encodeURIComponent(returnTo)}`);
  }

  const user = await basePrisma.user.findUnique({
    where: { id: auth.userId },
    select: { role: true, status: true },
  });

  // 계정 부재/익명화/비활성(잠금·탈퇴) 또는 비운영자 역할 → 백오피스 미노출(404).
  if (user === null || user.status !== UserStatus.ACTIVE || !OPERATOR_ROLES.includes(user.role)) {
    notFound();
  }

  return { userId: auth.userId, role: user.role };
}
