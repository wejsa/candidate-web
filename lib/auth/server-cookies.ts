// CANDID-014 Step 3 — RSC(Server Component / Server Action) 전용 Optional 인증 헬퍼.
// NextRequest 의존 없이 next/headers의 cookies()로 Access 토큰을 검증한다.
// Route Handler는 기존 lib/auth/middleware.ts의 requireAuth/getOptionalAuth 사용 (NextRequest 기반).

import 'server-only';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE } from '@/lib/auth/cookies';
import { verifyAccessToken } from '@/lib/auth/jwt';
import type { AuthContext } from '@/lib/auth/middleware';

/**
 * RSC에서 호출 가능한 Optional 인증 — Access 토큰 유효 시 AuthContext, 아니면 null.
 * Next.js 15: cookies()가 Promise / 14: 동기 ReadonlyRequestCookies — await으로 양쪽 호환.
 * lib/auth/middleware.ts의 getOptionalAuth는 NextRequest 의존이라 RSC에서 호출 불가 → 본 함수 분리.
 */
export async function getOptionalAuthFromCookies(): Promise<AuthContext | null> {
  const store = await cookies();
  const cookie = store.get(ACCESS_COOKIE);
  if (cookie === undefined || cookie.value === '') return null;
  const result = await verifyAccessToken(cookie.value);
  return result.ok ? { userId: result.claims.userId } : null;
}
