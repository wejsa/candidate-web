import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

// Prisma + verifyPassword + JWT + session 모두 mock — DB 의존 제거.
// login.ts 비즈니스 로직만 검증 (race-free 카운터/dummy verify/계정 열거 방지).

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));
vi.mock('@/lib/auth/password', () => ({
  verifyPassword: vi.fn(),
}));
vi.mock('@/lib/auth/jwt', () => ({
  issueAccessToken: vi.fn(async () => ({
    token: 'access-jwt',
    expiresAt: new Date('2026-06-01T00:00:00Z'),
  })),
}));
vi.mock('@/lib/auth/session', () => ({
  issueRefreshSession: vi.fn(async () => ({
    token: 'refresh-jwt',
    expiresAt: new Date('2026-06-15T00:00:00Z'),
    userId: 42,
    familyId: 'family-uuid',
    rotationCounter: 0,
  })),
}));

vi.mock('@/lib/audit/record', () => ({ recordAuditEvent: vi.fn() }));

const { prisma } = (await import('@/lib/prisma')) as unknown as {
  prisma: { user: { findUnique: Mock; updateMany: Mock } };
};
const { recordAuditEvent } = (await import('@/lib/audit/record')) as unknown as {
  recordAuditEvent: Mock;
};
const { verifyPassword } = (await import('@/lib/auth/password')) as unknown as {
  verifyPassword: Mock;
};
const { issueAccessToken } = (await import('@/lib/auth/jwt')) as unknown as {
  issueAccessToken: Mock;
};
const { issueRefreshSession } = (await import('@/lib/auth/session')) as unknown as {
  issueRefreshSession: Mock;
};
const { signin } = await import('@/lib/auth/login');

const validInput = {
  email: 'user@example.com',
  password: 'CorrectHorse!23',
  rememberMe: false,
};

/** ACTIVE 사용자 기본 fixture (passwordHash 존재, 잠금 없음, 카운터 0). */
function makeActiveUser(overrides: Partial<{
  id: number;
  email: string;
  name: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  status: string;
}> = {}) {
  return {
    id: 42,
    email: 'user@example.com',
    name: '테스트유저',
    passwordHash: '$2a$12$realhashplaceholderforuser_____________________________',
    emailVerifiedAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    status: 'ACTIVE' as const,
    ...overrides,
  };
}

beforeEach(() => {
  // CANDID-037 L-027 패턴: vi.resetAllMocks가 vi.mock factory의 default impl까지 리셋하므로
  // 호출 사이드 이펙트가 있는 mock(Promise 반환)은 매번 default impl 재설정 필요.
  vi.resetAllMocks();
  verifyPassword.mockResolvedValue(true);
  issueAccessToken.mockResolvedValue({
    token: 'access-jwt',
    expiresAt: new Date('2026-06-01T00:00:00Z'),
  });
  issueRefreshSession.mockResolvedValue({
    token: 'refresh-jwt',
    expiresAt: new Date('2026-06-15T00:00:00Z'),
    userId: 42,
    familyId: 'family-uuid',
    rotationCounter: 0,
  });
});

// CANDID-046: afterEach(vi.restoreAllMocks()) 제거 — beforeEach의 resetAllMocks+default 재설정으로
//   파일 내 격리는 충분하며, 전역 restore는 워커 공유 시 다음 파일의 prisma mock을 비워 간헐 실패를 유발했다.

describe('signin — 정상 로그인 (US-AUTH-002 happy path)', () => {
  it('이메일/비밀번호 일치 → 토큰 발급 + failedLoginCount/lockedUntil 리셋', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(makeActiveUser({ failedLoginCount: 3 }));

    const result = await signin(validInput);
    expect(result.user.id).toBe(42);
    expect(result.tokens.accessToken).toBe('access-jwt');
    expect(result.tokens.refreshToken).toBe('refresh-jwt');

    // 성공 path는 무조건 카운터 리셋 (lazy reset 정책)
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  });

  it('rememberMe=true → issueRefreshSession에 rememberMe 전달 (Refresh 14일)', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(makeActiveUser());
    await signin({ ...validInput, rememberMe: true });
    expect(issueRefreshSession).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ rememberMe: true }),
    );
  });

  it('rememberMe=false → Refresh 1일 정책 (issueRefreshSession opts)', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(makeActiveUser());
    await signin({ ...validInput, rememberMe: false });
    expect(issueRefreshSession).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ rememberMe: false }),
    );
  });

  it('userAgent / ipAddress가 issueRefreshSession에 전달됨 (감사 로그 메타)', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(makeActiveUser());
    await signin(validInput, { userAgent: 'curl/8.0', ipAddress: '203.0.113.5' });
    expect(issueRefreshSession).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ userAgent: 'curl/8.0', ipAddress: '203.0.113.5' }),
    );
  });

  it('이메일은 lower-case로 정규화된 입력 그대로 findUnique 호출', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(makeActiveUser());
    await signin(validInput);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'user@example.com' },
      select: expect.objectContaining({
        passwordHash: true,
        failedLoginCount: true,
        lockedUntil: true,
        status: true,
      }),
    });
  });
});

describe('signin — 실패 분기 (계정 열거 방지)', () => {
  it('이메일 부재 → dummy verifyPassword 호출 + AUTH_INVALID_CREDENTIALS (BR-AUTH-03)', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);

    await expect(signin(validInput)).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
      status: 401,
    });

    // timing oracle 차단 — 사용자 부재여도 dummy verify를 호출해야 응답 시간 균등화.
    expect(verifyPassword).toHaveBeenCalledTimes(1);
    const [plain, hash] = verifyPassword.mock.calls[0] ?? [];
    expect(plain).toBe(validInput.password);
    // dummy hash는 bcrypt 형식 ($2a$ or $2b$로 시작)
    expect(hash).toMatch(/^\$2[ab]\$12\$/);

    // 사용자 부재 → updateMany 미호출 (대상 row 없음)
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('소셜 전용 계정(passwordHash=null) → dummy verify + AUTH_INVALID_CREDENTIALS', async () => {
    // 소셜 전용 사용자: passwordHash null. enumeration 방지 위해 동일 응답.
    prisma.user.findUnique.mockResolvedValueOnce(
      makeActiveUser({ passwordHash: null }),
    );

    await expect(signin(validInput)).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });

    // dummy hash로 verify 호출되어야 timing 균등 (passwordHash null → DUMMY_BCRYPT_HASH 분기)
    expect(verifyPassword).toHaveBeenCalledTimes(1);
    const [, hash] = verifyPassword.mock.calls[0] ?? [];
    expect(hash).toMatch(/^\$2[ab]\$12\$/);
  });

  it('비밀번호 불일치 → AUTH_INVALID_CREDENTIALS + failedLoginCount increment', async () => {
    verifyPassword.mockResolvedValueOnce(false);
    prisma.user.findUnique.mockResolvedValueOnce(makeActiveUser({ failedLoginCount: 2 }));

    await expect(signin(validInput)).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });

    // L-024 race-free 패턴: increment는 WHERE failedLoginCount < 4 조건
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 42, failedLoginCount: { lt: 4 } },
      data: { failedLoginCount: { increment: 1 } },
    });
  });

  it('비활성 상태(SUSPENDED) → AUTH_INVALID_CREDENTIALS + dummy verify 호출 + 카운터 증가 X (review H002 fix)', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(
      makeActiveUser({ status: 'SUSPENDED' as const, failedLoginCount: 2 }),
    );

    await expect(signin(validInput)).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });

    // H002 회귀 가드 — SUSPENDED 사용자도 dummy verify로 timing 균등화
    expect(verifyPassword).toHaveBeenCalledTimes(1);
    const [, hash] = verifyPassword.mock.calls[0] ?? [];
    expect(hash).toMatch(/^\$2[ab]\$12\$/);

    // H002 회귀 가드 — 비활성 사용자는 카운터 증가 없음 (의미 없는 부작용 차단)
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  // it.each — H002 회귀 가드 (모든 비-ACTIVE status 동일 응답 + 카운터 미증가)
  it.each(['SUSPENDED', 'WITHDRAWN'] as const)(
    'status=%s → AUTH_INVALID_CREDENTIALS + dummy verify + 카운터 X (enum 확장 회귀 가드)',
    async (status) => {
      prisma.user.findUnique.mockResolvedValueOnce(makeActiveUser({ status }));
      await expect(signin(validInput)).rejects.toMatchObject({
        code: 'AUTH_INVALID_CREDENTIALS',
      });
      expect(verifyPassword).toHaveBeenCalledTimes(1);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    },
  );

  it('verifyPassword가 throw → 예외 그대로 전파 (현재는 false 변환되나 회귀 가드)', async () => {
    // 현재 verifyPassword는 내부 try/catch로 false 반환하나, mock에서 직접 throw 시 signin은 그대로 throw 전파.
    // 운영 환경에서 bcrypt 라이브러리가 손상된 해시로 throw하면 500이 노출 — 향후 명시적 catch 검토.
    prisma.user.findUnique.mockResolvedValueOnce(makeActiveUser());
    verifyPassword.mockRejectedValueOnce(new Error('malformed hash'));

    await expect(signin(validInput)).rejects.toThrow('malformed hash');
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});

describe('signin — 잠금 (BR-AUTH-03)', () => {
  it('lockedUntil > now → AUTH_ACCOUNT_LOCKED (429)', async () => {
    const future = new Date(Date.now() + 5 * 60_000); // 5분 후
    prisma.user.findUnique.mockResolvedValueOnce(
      makeActiveUser({ failedLoginCount: 5, lockedUntil: future }),
    );

    await expect(signin(validInput)).rejects.toMatchObject({
      code: 'AUTH_ACCOUNT_LOCKED',
      status: 429,
    });

    // 잠금 응답은 verifyPassword 미호출 (조기 차단)
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('lockedUntil이 과거 (잠금 만료) + 비밀번호 정확 → 정상 처리 + 카운터 리셋', async () => {
    const past = new Date(Date.now() - 60_000); // 1분 전 만료
    prisma.user.findUnique.mockResolvedValueOnce(
      makeActiveUser({ failedLoginCount: 5, lockedUntil: past }),
    );
    // verifyPassword 기본 mockResolvedValue(true)

    const result = await signin(validInput);
    expect(result.user.id).toBe(42);

    // 만료 후 첫 성공 — 카운터 리셋 (lazy reset 정책)
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  });

  it('5번째 실패 (failedLoginCount=4) → LOCK 전이 (idempotent updateMany)', async () => {
    verifyPassword.mockResolvedValueOnce(false);
    prisma.user.findUnique.mockResolvedValueOnce(makeActiveUser({ failedLoginCount: 4 }));

    await expect(signin(validInput)).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });

    // L-024 idempotent LOCK 전이 — lockedUntil: null 조건으로 동시 두 트랜잭션 중 하나만 갱신.
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 42, lockedUntil: null },
      data: expect.objectContaining({
        failedLoginCount: 5,
        lockedUntil: expect.any(Date),
      }),
    });

    // 잠금 시각은 약 15분 후
    const updateCall = prisma.user.updateMany.mock.calls[0]?.[0] as
      | { data: { lockedUntil: Date } }
      | undefined;
    const lockedUntil = updateCall?.data.lockedUntil;
    if (!lockedUntil) throw new Error('lockedUntil 미설정');
    const deltaMs = lockedUntil.getTime() - Date.now();
    expect(deltaMs).toBeGreaterThan(14 * 60_000);
    expect(deltaMs).toBeLessThan(16 * 60_000);
  });

  it('잠금 만료 후 잘못된 비밀번호 → 새 사이클 시작 (failedLoginCount=1로 리셋) — H001 회귀 가드', async () => {
    // 시나리오: failedLoginCount=5 + lockedUntil 과거 (만료)
    // 기존 버그: increment 분기는 lt:4 조건으로 매치 안 됨, LOCK 전이 분기는 lockedUntil:null 조건 미달
    //         → updateMany 0건 호출, 카운터 정체 → 무제한 brute-force 가능
    // H001 fix: lockedUntil < now 조건으로 새 사이클 시작 (failedLoginCount=1로 리셋)
    const past = new Date(Date.now() - 60_000);
    verifyPassword.mockResolvedValueOnce(false);
    prisma.user.findUnique.mockResolvedValueOnce(
      makeActiveUser({ failedLoginCount: 5, lockedUntil: past }),
    );

    await expect(signin(validInput)).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });

    // H001 회귀 가드: 만료된 잠금 분기 — lockedUntil { lt: now } 조건으로 reset
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 42, lockedUntil: { lt: expect.any(Date) } },
      data: { failedLoginCount: 1, lockedUntil: null },
    });
  });

  it('failedLoginCount=4 미만 (예: 3) → LOCK 전이 없이 increment만', async () => {
    verifyPassword.mockResolvedValueOnce(false);
    prisma.user.findUnique.mockResolvedValueOnce(makeActiveUser({ failedLoginCount: 3 }));

    await expect(signin(validInput)).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });

    // 3 → 4로 increment 호출만, LOCK 전이 미호출.
    expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
    const call = prisma.user.updateMany.mock.calls[0]?.[0] as
      | { where: Record<string, unknown>; data: Record<string, unknown> }
      | undefined;
    expect(call?.where).toMatchObject({ id: 42, failedLoginCount: { lt: 4 } });
    expect(call?.data).toMatchObject({ failedLoginCount: { increment: 1 } });
  });
});

describe('signin — race-free updateMany 패턴 (L-024 회귀 가드)', () => {
  it('성공 path의 카운터 리셋은 조건 없는 updateMany (id만) — 만료 후 첫 성공도 무조건 리셋', async () => {
    // 잠금이 풀린 직후 (lockedUntil=null + count=3 상태)
    prisma.user.findUnique.mockResolvedValueOnce(makeActiveUser({ failedLoginCount: 3 }));

    await signin(validInput);

    // 성공 path는 lockedUntil 조건 없이 무조건 리셋 (이전 잠금 잔재 청소)
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 42 }, // failedLoginCount/lockedUntil 조건 *없음* — 무조건 갱신
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  });

  it('실패 increment의 WHERE 조건은 lt:4 (race-free 한도)', async () => {
    verifyPassword.mockResolvedValueOnce(false);
    prisma.user.findUnique.mockResolvedValueOnce(makeActiveUser({ failedLoginCount: 0 }));

    await expect(signin(validInput)).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });

    const call = prisma.user.updateMany.mock.calls[0]?.[0] as
      | { where: { failedLoginCount?: { lt?: number } } }
      | undefined;
    // L-024 회귀 가드 — lt:4 (= LOCK_THRESHOLD - 1) 조건 유지
    expect(call?.where.failedLoginCount).toEqual({ lt: 4 });
  });

  it('LOCK 전이 updateMany는 lockedUntil: null 조건 (idempotent)', async () => {
    verifyPassword.mockResolvedValueOnce(false);
    prisma.user.findUnique.mockResolvedValueOnce(makeActiveUser({ failedLoginCount: 4 }));

    await expect(signin(validInput)).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });

    const call = prisma.user.updateMany.mock.calls[0]?.[0] as
      | { where: { lockedUntil?: null } }
      | undefined;
    // L-024 회귀 가드 — lockedUntil: null 조건으로 동시 LOCK 전이 race 차단
    expect(call?.where.lockedUntil).toBeNull();
  });
});

// CANDID-026 Step 3 — 로그인 감사 이벤트 emit (LOGIN_SUCCESS / LOGIN_FAILURE).
describe('signin — 감사 이벤트 (CANDID-026)', () => {
  it('성공 시 LOGIN_SUCCESS를 actorUserId/ip/ua와 함께 emit', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(makeActiveUser());
    prisma.user.updateMany.mockResolvedValue({ count: 1 });

    await signin(validInput, { ipAddress: '10.0.0.9', userAgent: 'vitest-ua' });

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'LOGIN_SUCCESS',
        actorUserId: 42,
        resourceType: 'user',
        resourceId: '42',
        ipAddress: '10.0.0.9',
        userAgent: 'vitest-ua',
      }),
    );
  });

  it('비밀번호 불일치 시 LOGIN_FAILURE(invalid_credentials) emit', async () => {
    verifyPassword.mockResolvedValueOnce(false);
    prisma.user.findUnique.mockResolvedValueOnce(makeActiveUser());

    await expect(signin(validInput)).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'LOGIN_FAILURE',
        actorUserId: 42,
        metadata: { reason: 'invalid_credentials' },
      }),
    );
  });

  it('이메일 부재 시 LOGIN_FAILURE를 actorUserId=null로 emit (enumeration 방지)', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);

    await expect(signin(validInput)).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'LOGIN_FAILURE', actorUserId: null }),
    );
  });

  it('잠금 상태 시 LOGIN_FAILURE(account_locked) emit', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(
      makeActiveUser({ lockedUntil: new Date('2999-01-01T00:00:00Z') }),
    );

    await expect(signin(validInput)).rejects.toMatchObject({ code: 'AUTH_ACCOUNT_LOCKED' });

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'LOGIN_FAILURE', metadata: { reason: 'account_locked' } }),
    );
  });
});
