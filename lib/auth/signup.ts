import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { issueAccessToken } from '@/lib/auth/jwt';
import { issueRefreshSession } from '@/lib/auth/session';
import { hashPassword } from '@/lib/auth/password';
import { generateTokenHex, sha256Hex } from '@/lib/auth/token-hash';
import type { SignupInput } from '@/lib/auth/validation';

// CANDID-010 Step 2 — 회원가입 비즈니스 로직 (US-AUTH-001).
// 트랜잭션 경계 (db-designer 권고):
//   [bcryptjs hashPassword 트랜잭션 밖] → BEGIN
//     User INSERT + EmailVerification INSERT + RefreshToken(via issueRefreshSession) → COMMIT
//   [Access JWT 발급 + 메일 발송은 트랜잭션 밖]
// BR-AUTH-04: 미인증 상태로도 자동 로그인 — emailVerifiedAt=null로 반환, 클라이언트가 UI 안내.

/** 인증 토큰 유효기간 24시간 (US-AUTH-001). */
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface SignupResult {
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
  /** 평문 인증 토큰 — 메일 발송 후 호출측에서 폐기. DB에는 sha256만 저장. */
  verificationToken: string;
}

export interface SignupContext {
  userAgent?: string | null;
  ipAddress?: string | null;
}

/**
 * 가입 + 자동 로그인 + 인증 토큰 발행을 단일 흐름으로 처리.
 * 중복 이메일은 `USER_EMAIL_DUPLICATED` (409) throw. zod 입력은 호출측에서 사전 검증.
 */
export async function createUserAndIssueTokens(
  input: SignupInput,
  context: SignupContext = {},
): Promise<SignupResult> {
  // 1) BCrypt 해싱은 트랜잭션 밖 (DB 커넥션 점유 회피, ~250ms)
  const passwordHash = await hashPassword(input.password);

  // 2) 평문 인증 토큰 발행 (URL용) — 트랜잭션 외부에서 생성. DB에는 sha256만 저장.
  const verificationToken = generateTokenHex(32);
  const verificationHash = sha256Hex(verificationToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_MS);

  // 3) 동의 시각 — zod literal(true) 통과한 입력이므로 모두 now로 기록.
  //    marketingAgreed는 사용자가 false로 보낸 경우 null로 유지(미동의 시각 미기록).
  const consentAt = now;
  const marketingAgreedAt = input.marketingAgreed ? now : null;

  // 4) User + EmailVerification 트랜잭션 — 가입 = 인증 대기 상태 보장 (실패 시 둘 다 롤백).
  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          name: input.name,
          termsAgreedAt: consentAt,
          privacyAgreedAt: consentAt,
          ageConfirmedAt: consentAt,
          marketingAgreedAt,
        },
        select: {
          id: true,
          email: true,
          name: true,
          emailVerifiedAt: true,
        },
      });
      await tx.emailVerification.create({
        data: {
          userId: created.id,
          tokenHash: verificationHash,
          expiresAt,
          lastSentAt: now,
        },
      });
      return created;
    });
  } catch (err) {
    // Prisma P2002 (unique constraint) → 중복 이메일.
    if (isUniqueConstraintError(err, 'email')) {
      throw new AppError('USER_EMAIL_DUPLICATED');
    }
    throw err;
  }

  // 5) JWT Access + Refresh 발급 — 트랜잭션 밖(refresh DB INSERT는 issueRefreshSession 내부).
  //    가입 직후 자동 로그인 (BR-AUTH-04: 미인증 상태도 로그인 가능, 지원서 제출만 차단).
  const access = await issueAccessToken(user.id);
  const refreshSession = await issueRefreshSession(user.id, {
    rememberMe: true, // 가입 직후는 기본 14일
    userAgent: context.userAgent,
    ipAddress: context.ipAddress,
  });

  return {
    user,
    tokens: {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken: refreshSession.token,
      refreshExpiresAt: refreshSession.expiresAt,
    },
    verificationToken,
  };
}

/**
 * Prisma P2002 unique constraint 위반 + 대상 컬럼 검사.
 * Step 3 fix(Step 2 review D3): `as` 캐스팅 대신 instanceof로 타입 가드 강화 —
 * 임의 객체에 `code: 'P2002'` 속성이 있더라도 Prisma 에러로 오인하지 않는다.
 */
function isUniqueConstraintError(err: unknown, column: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.includes(column);
  if (typeof target === 'string') return target.includes(column);
  return false;
}
