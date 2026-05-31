import 'server-only';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { maskPhone } from '@/lib/pii/mask';
import type { ProfileDto, ProfileProviderName } from '@/lib/users/types';

// CANDID-024 Step 1 — 프로필 조회 서비스 (US-MY-004, GET /api/v1/users/me).
//
// prisma($extends piiExtension)가 User.phone을 평문 string으로 자동 복호화한다 (lib/prisma/extends.ts).
// 본 서비스는 그 평문을 maskPhone으로만 외부에 노출하고 passwordHash는 boolean으로만 환원한다 (L-006).
// requireAuth를 통과한 토큰이라도 계정이 탈퇴/삭제됐을 수 있으므로 일관되게 USER_NOT_FOUND로 처리한다.

function toProviderName(provider: 'GOOGLE' | 'GITHUB'): ProfileProviderName {
  // AuthProviderType enum(GOOGLE/GITHUB) → 클라이언트 표기(소문자). OAuthProviderName 컨벤션과 일치.
  return provider === 'GOOGLE' ? 'google' : 'github';
}

export async function getProfile(userId: number): Promise<ProfileDto> {
  // include(기본 select)로 조회 — piiExtension result hook이 phone을 평문 string으로 환원.
  // 평문/해시는 본 함수 내부에서만 머무르고 DTO에는 마스킹/boolean 형태로만 담는다.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      authProviders: {
        select: { provider: true, linkedAt: true },
        orderBy: { linkedAt: 'asc' },
      },
    },
  });

  if (user === null || user.status === 'WITHDRAWN') {
    throw new AppError('USER_NOT_FOUND');
  }

  return {
    name: user.name,
    email: user.email,
    // user.phone: piiExtension이 복호화한 평문 string | null. maskPhone으로만 노출.
    phoneMasked: maskPhone(user.phone),
    hasPassword: user.passwordHash !== null,
    providers: user.authProviders.map((p) => ({
      provider: toProviderName(p.provider),
      linkedAt: p.linkedAt.toISOString(),
    })),
  };
}
