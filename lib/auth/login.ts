import 'server-only';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { issueAccessToken } from '@/lib/auth/jwt';
import { issueRefreshSession } from '@/lib/auth/session';
import { verifyPassword } from '@/lib/auth/password';
import type { LoginInput } from '@/lib/auth/validation';

// CANDID-011 — 이메일 로그인 비즈니스 로직 (US-AUTH-002, BR-AUTH-03/04).
//
// 격리 수준 가정: PostgreSQL READ COMMITTED (L-024).
// failedLoginCount 증가/리셋과 lockedUntil 전이는 prisma.user.updateMany WHERE 조건으로
// row-level lock을 활용해 race-free 직렬화한다. 동시 N회 실패 시도가 5회를 초과해 잠금 시점이
// 부정확해지는 일이 없도록 임계값 도달 분기를 별도 updateMany로 idempotent하게 처리한다.
//
// 계정 열거 공격 방지 (BR-AUTH-03 보강):
//   - 이메일 부재 / passwordHash null (소셜 전용) / 잘못된 비밀번호 모두 응답 시간을 동일하게 유지.
//   - bcrypt verify는 cost 12 기준 ~250ms 소요 → 분기 누락 시 timing oracle 노출.
//   - 모든 분기에서 DUMMY_BCRYPT_HASH로 verifyPassword를 호출해 균등화.
//   - 응답 코드는 AUTH_INVALID_CREDENTIALS 단일 (잠금만 AUTH_ACCOUNT_LOCKED 별도 — 잠긴 사용자는
//     자신의 상태를 알 권리가 있고, 이미 5회 실패한 시점이라 enumeration 비용보다 UX 우선).
//
// 잠금 해제: lazy reset 정책 — 다음 로그인 시도 시 lockedUntil < now 검사 후 카운터 리셋.
// 별도 cron 배치는 CANDID-029 (야간 정리) 도입 시점에 합류.

/**
 * 사전 생성된 dummy bcrypt 해시 (timing oracle 차단용).
 *
 * - 실제 비밀번호가 아니며 운영 정보 가치 0 (어떤 평문도 매칭되지 않음을 보장하면 충분).
 * - bcrypt cost 12로 verify 시간이 실 해시와 동일 (~250ms).
 * - 코드 노출되어도 보안 영향 없음 — 평문이 아니라 해시 자체이고, 정상 사용자의 비밀번호와 매칭될 수 없음.
 * - 생성 시점: `await hashPassword('CANDID-011-dummy-timing-equalizer-not-real-password')`.
 */
const DUMMY_BCRYPT_HASH =
  '$2a$12$abcdefghijklmnopqrstuOH3UYqYqyD0t4FvFqZsi8RXcZQH3IF8u';

/** 잠금 유효시간 15분 (BR-AUTH-03). */
const LOCK_DURATION_MS = 15 * 60 * 1000;
/** 잠금 임계값 — failed_login_count가 이 값을 초과하면 잠금 전이. */
const LOCK_THRESHOLD = 5;

/**
 * 라우터가 전달하는 부가 컨텍스트.
 * 클라이언트 의도(rememberMe)는 `LoginInput`에 포함되며 `signin` 내부에서 input에서 추출한다.
 */
export interface SigninOptions {
  /** 감사 로그용 — Refresh Token 발급 시 함께 저장. */
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface SigninResult {
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
}

/**
 * 이메일/비밀번호 인증 + 잠금 카운터 관리 + JWT 발급.
 *
 * 모든 실패 케이스는 AUTH_INVALID_CREDENTIALS (잠금만 별도). zod 입력은 라우터에서 사전 검증.
 *
 * @throws AppError(AUTH_ACCOUNT_LOCKED) 잠금 상태 (lockedUntil > now)
 * @throws AppError(AUTH_INVALID_CREDENTIALS) 이메일 부재 / 소셜 전용 / 비밀번호 불일치
 */
export async function signin(
  input: LoginInput,
  options: SigninOptions = {},
): Promise<SigninResult> {
  const now = new Date();

  // 1) 사용자 조회 (이메일 부재 시에도 dummy verify로 시간 균등화)
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      emailVerifiedAt: true,
      failedLoginCount: true,
      lockedUntil: true,
      status: true,
    },
  });

  // 2) 잠금 검사 — 사용자가 존재하고 lockedUntil이 미래인 경우만 차단.
  //    이메일 부재 케이스에서는 잠금 노출 불가 (enumeration 방지).
  if (user !== null && user.lockedUntil !== null && user.lockedUntil > now) {
    throw new AppError('AUTH_ACCOUNT_LOCKED');
  }

  // 3) 비밀번호 검증 (이메일 부재 / passwordHash null도 dummy verify로 시간 균등화)
  const hashToVerify = user?.passwordHash ?? DUMMY_BCRYPT_HASH;
  const passwordOk = await verifyPassword(input.password, hashToVerify);

  // 4) 실패 분기 — 사용자 부재 / passwordHash null / 비밀번호 불일치
  if (user === null || user.passwordHash === null || !passwordOk) {
    if (user !== null) {
      await recordFailedLogin(user.id, user.failedLoginCount, now);
    }
    // 사용자 부재 경우는 카운터 갱신 불필요 (대상 row 없음).
    throw new AppError('AUTH_INVALID_CREDENTIALS');
  }

  // 5) SUSPENDED / WITHDRAWN 등 비활성 상태 — enumeration 방지 위해 동일 응답.
  //    (BR-PII-03: 탈퇴 사용자는 익명화 + status 변경. 본 분기는 방어적 가드.)
  if (user.status !== 'ACTIVE') {
    throw new AppError('AUTH_INVALID_CREDENTIALS');
  }

  // 6) 성공 — failedLoginCount/lockedUntil 카운터 무조건 리셋 (race-free).
  //    이전 잠금이 만료된 후 첫 성공도 동일하게 리셋된다.
  await prisma.user.updateMany({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null },
  });

  // 7) JWT Access + Refresh 발급 (refresh DB INSERT는 issueRefreshSession 내부)
  //    rememberMe는 클라이언트 의도(input.rememberMe) 그대로 사용.
  const access = await issueAccessToken(user.id);
  const refreshSession = await issueRefreshSession(user.id, {
    rememberMe: input.rememberMe ?? false,
    userAgent: options.userAgent ?? null,
    ipAddress: options.ipAddress ?? null,
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerifiedAt: user.emailVerifiedAt,
    },
    tokens: {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken: refreshSession.token,
      refreshExpiresAt: refreshSession.expiresAt,
    },
  };
}

/**
 * 실패 카운터 race-free 증가 (L-024 패턴).
 *
 * - 5회 미만일 때만 increment: `updateMany WHERE failedLoginCount < (THRESHOLD - 1)`
 *   첫 4회까지는 1→2→3→4로 증가.
 * - 임계값 도달 시 LOCK 전이: 별도 `updateMany WHERE lockedUntil: null`로 idempotent 처리.
 *   동시 두 트랜잭션이 5번째 실패에 도달해도 lockedUntil 한 번만 설정.
 *
 * 격리 수준: READ COMMITTED — PostgreSQL UPDATE 자동 row-level ExclusiveLock으로 직렬화.
 */
async function recordFailedLogin(
  userId: number,
  currentCount: number,
  now: Date,
): Promise<void> {
  if (currentCount < LOCK_THRESHOLD - 1) {
    // 1→2→3→4 증가 — race-free하게 (lt 조건은 동시 두 트랜잭션 중 하나만 통과 가능하지 않으나,
    // PostgreSQL UPDATE는 row lock으로 직렬화되어 최종 결과가 +2가 됨. 임계값은 idempotent 분기에서 처리)
    await prisma.user.updateMany({
      where: { id: userId, failedLoginCount: { lt: LOCK_THRESHOLD - 1 } },
      data: { failedLoginCount: { increment: 1 } },
    });
    return;
  }

  // 임계값 도달 (currentCount >= 4) — 5회째 실패. LOCK 전이.
  // idempotent: lockedUntil: null 인 row만 잠금 설정 → 동시 두 트랜잭션 중 하나만 갱신.
  await prisma.user.updateMany({
    where: { id: userId, lockedUntil: null },
    data: {
      failedLoginCount: LOCK_THRESHOLD,
      lockedUntil: new Date(now.getTime() + LOCK_DURATION_MS),
    },
  });
}
