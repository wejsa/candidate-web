import 'server-only';
import { AuthProviderType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import type { OAuthProviderName } from '@/lib/auth/oauth/state';

// CANDID-024 Step 4 — 소셜 계정 연결 해제 (US-MY-004).
//
// CRITICAL 불변식 (db-designer): "마지막 인증수단 해제 차단" — passwordHash NULL && 잔여 provider 0이 되는
// 해제는 거부(orphan 로그인-불가 계정 방지). 두 테이블+집계라 DB CHECK 불가 → 앱 트랜잭션 + 행 잠금으로 강제.
// 동시 해제/비번 제거 race(TOCTOU)는 user 행 FOR UPDATE 잠금으로 차단한다.

const PROVIDER_ENUM: Record<OAuthProviderName, AuthProviderType> = {
  google: AuthProviderType.GOOGLE,
  github: AuthProviderType.GITHUB,
};

export interface UnlinkProviderInput {
  userId: number;
  provider: OAuthProviderName;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export async function unlinkProvider(input: UnlinkProviderInput): Promise<void> {
  const providerEnum = PROVIDER_ENUM[input.provider];

  await prisma.$transaction(async (tx) => {
    // user 행 잠금 — 동시 해제/비번제거 race 차단. id만 SELECT(PII 미접근)이라 piiExtension 우회 우려 없음.
    // eslint-disable-next-line no-restricted-syntax -- FOR UPDATE 잠금 전용, PII 컬럼 미선택 (db-designer CRITICAL 가드)
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`;

    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { passwordHash: true, status: true },
    });
    if (user === null || user.status === 'WITHDRAWN') {
      throw new AppError('USER_NOT_FOUND');
    }

    const providers = await tx.authProvider.findMany({
      where: { userId: input.userId },
      select: { provider: true },
    });
    const isLinked = providers.some((p) => p.provider === providerEnum);
    if (!isLinked) {
      throw new AppError('USER_PROVIDER_NOT_LINKED');
    }

    // 해제 후 잔여 인증수단 = (비밀번호 보유 ? 1 : 0) + (대상 외 provider 수).
    const remaining =
      (user.passwordHash !== null ? 1 : 0) +
      providers.filter((p) => p.provider !== providerEnum).length;
    if (remaining < 1) {
      throw new AppError('USER_LAST_AUTH_METHOD');
    }

    await tx.authProvider.delete({
      where: { userId_provider: { userId: input.userId, provider: providerEnum } },
    });

    // 감사 로그: OAUTH_LINKED/UNLINKED 이벤트는 AuditEventType enum에 없어 마이그레이션이 필요하다.
    // Step 4는 스키마 변경 없음 범위이므로 audit 이벤트 추가는 Step 5(link-add, 동일 enum 필요) 또는
    // CANDID-026(감사 로그 AOP)로 위임한다. userAgent/ipAddress는 그때 사용하기 위해 시그니처에 유지.
  });
}
