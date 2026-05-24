import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { issueAccessToken } from '@/lib/auth/jwt';
import { issueRefreshSession } from '@/lib/auth/session';
import { isUniqueViolationOn } from '@/lib/prisma/errors';
import type { OAuthProfile, OAuthProviderName } from '@/lib/auth/oauth';

// CANDID-012 Step 3 — OAuth profile → User (BR-AUTH-06 자동 연결 차단).
//
// 트랜잭션 분기:
//   A) `(provider, providerUserId)`로 기존 AuthProvider 매칭 → signin (linkAction='signin')
//   B) email 일치하는 User가 있고 위 AuthProvider 부재 → AUTH_OAUTH_EMAIL_TAKEN throw (BR-AUTH-06).
//      사용자에게 "이메일 로그인 후 마이페이지에서 소셜 연동" 안내.
//   C) 신규 사용자 → User + AuthProvider 동시 생성 (linkAction='created').
//      자동 동의: termsAgreedAt/privacyAgreedAt = now (PRD US-AUTH-003 "자동 가입 처리").
//      ⚠️ 개인정보보호법 §22 명시 동의 페이지는 별도 follow-up task (현 P0 범위 외).
//
// 격리 수준 가정: PostgreSQL READ COMMITTED.
// `(provider, providerUserId)` UNIQUE / `User.email` UNIQUE 제약이 race-free 보장의 핵심.
// P2002 발생 시 retry 1회 후 throw (다른 트랜잭션이 동일 user를 동시 생성한 케이스).

export type OAuthLinkAction = 'signin' | 'created';

export interface LinkOAuthOptions {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface LinkOAuthResult {
  user: {
    id: number;
    email: string;
    name: string;
    emailVerifiedAt: Date | null;
  };
  tokens: {
    accessToken: string;
    accessExpiresAt: Date;
    refreshToken: string;
    refreshExpiresAt: Date;
  };
  linkAction: OAuthLinkAction;
}

/**
 * OAuth callback 핸들러의 핵심 비즈니스. 단일 트랜잭션으로 분기 A/B/C 처리.
 *
 * @throws AppError(AUTH_OAUTH_EMAIL_TAKEN) BR-AUTH-06 — 동일 이메일 가입 사용자 존재
 */
export async function linkOrCreateOAuthUser(args: {
  provider: OAuthProviderName;
  profile: OAuthProfile;
  options?: LinkOAuthOptions;
}): Promise<LinkOAuthResult> {
  const { provider, profile, options = {} } = args;
  const providerEnum = provider === 'google' ? 'GOOGLE' : 'GITHUB';
  const now = new Date();

  const linkResult = await prisma.$transaction(async (tx) => {
    // (A) 기존 OAuth 연결 매칭 — 가장 일반적인 재로그인 경로.
    const existing = await tx.authProvider.findUnique({
      where: {
        provider_providerUserId: {
          provider: providerEnum,
          providerUserId: profile.providerUserId,
        },
      },
      select: {
        userId: true,
      },
    });

    if (existing !== null) {
      const linkedUser = await tx.user.findUnique({
        where: { id: existing.userId },
        select: {
          id: true,
          email: true,
          name: true,
          emailVerifiedAt: true,
          status: true,
        },
      });
      if (linkedUser === null) {
        // FK CASCADE 보호로 발생 불가하나 fail-safe.
        throw new AppError('AUTH_INVALID_CREDENTIALS');
      }
      // 비활성 사용자(LOCKED/WITHDRAWN) 차단 — 일반 로그인과 동일 정책.
      if (linkedUser.status !== 'ACTIVE') {
        throw new AppError('AUTH_INVALID_CREDENTIALS');
      }
      return { user: linkedUser, action: 'signin' as const };
    }

    // (B) email로 기존 User 매칭 — 자동 연결 차단 (BR-AUTH-06).
    if (profile.email !== null) {
      const emailUser = await tx.user.findUnique({
        where: { email: profile.email },
        select: { id: true },
      });
      if (emailUser !== null) {
        throw new AppError('AUTH_OAUTH_EMAIL_TAKEN');
      }
    }

    // (C) 신규 가입 — User + AuthProvider 동시 생성.
    // profile.email이 null이면 임시 placeholder 이메일 (provider:providerUserId@oauth.local) 사용.
    // 클라이언트가 마이페이지에서 실 이메일 입력 + 인증 진행 예정 (follow-up).
    const emailValue =
      profile.email !== null
        ? profile.email
        : `${provider}-${profile.providerUserId}@oauth.local`;

    try {
      const created = await tx.user.create({
        data: {
          email: emailValue,
          name: profile.name,
          passwordHash: null,
          emailVerifiedAt: profile.emailVerified ? now : null,
          // PRD US-AUTH-003 자동 가입 — OAuth 동의 화면이 약관 동의를 묵시적 갈음한다고 가정.
          // 명시 동의 페이지 분리는 follow-up task (개인정보보호법 §22 명시 동의 강화).
          // review fix S-MAJOR-1.2: ageConfirmedAt도 함께 기록 (signup.ts와 일관성, 만 14세 자기 확인 시각).
          termsAgreedAt: now,
          privacyAgreedAt: now,
          ageConfirmedAt: now,
          authProviders: {
            create: {
              provider: providerEnum,
              providerUserId: profile.providerUserId,
              profileImageUrl: profile.profileImageUrl,
            },
          },
        },
        select: {
          id: true,
          email: true,
          name: true,
          emailVerifiedAt: true,
        },
      });
      return { user: created, action: 'created' as const };
    } catch (err) {
      // P2002: 동시 두 트랜잭션이 동일 email/provider_pid에 진입한 race — BR-AUTH-06로 수렴.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        isUniqueViolationOn(err, ['users_email_key', 'uk_auth_providers_provider_pid'])
      ) {
        throw new AppError('AUTH_OAUTH_EMAIL_TAKEN');
      }
      throw err;
    }
  });

  // 트랜잭션 외부에서 JWT 발급 — refresh DB INSERT 자체 트랜잭션 (issueRefreshSession 내부).
  // OAuth 흐름은 자동 rememberMe (사용자가 인터랙티브로 인증 완료한 상태) — Refresh 14일 TTL 정상.
  const access = await issueAccessToken(linkResult.user.id);
  const refreshSession = await issueRefreshSession(linkResult.user.id, {
    rememberMe: true,
    userAgent: options.userAgent ?? null,
    ipAddress: options.ipAddress ?? null,
  });

  return {
    user: {
      id: linkResult.user.id,
      email: linkResult.user.email,
      name: linkResult.user.name,
      emailVerifiedAt: linkResult.user.emailVerifiedAt,
    },
    tokens: {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken: refreshSession.token,
      refreshExpiresAt: refreshSession.expiresAt,
    },
    linkAction: linkResult.action,
  };
}
