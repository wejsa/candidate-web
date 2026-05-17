import { describe, expect, it } from 'vitest';
import { UserStatus } from '@prisma/client';
import {
  applicationPublicSchema,
  toApplicationPublic,
  toUserPublic,
  userPublicSchema,
  type ApplicationPublicInput,
  type UserPublicInput,
} from '@/lib/pii/serializer';

// CANDID-031 (D7) — userPublicSchema는 piiExtension으로 phone/birthDate가 평문 string으로
// 복호화된 User 객체를 입력으로 받아 마스킹 + 내부 필드 제거 + Date→ISO 직렬화 결과를 반환한다.
// 본 테스트는 외부 응답에 노출되어선 안 되는 필드(passwordHash 등)가 누설되지 않음을 회귀 차단한다.

function buildUser(overrides: Partial<UserPublicInput> = {}): UserPublicInput {
  return {
    id: 42,
    email: 'foo@example.com',
    name: '홍길동',
    phone: '010-1234-5678',
    birthDate: '1995-03-15',
    emailVerifiedAt: new Date('2026-04-01T12:00:00Z'),
    status: UserStatus.ACTIVE,
    withdrawnAt: null,
    createdAt: new Date('2026-03-01T09:00:00Z'),
    updatedAt: new Date('2026-04-01T12:00:00Z'),
    ...overrides,
  };
}

describe('userPublicSchema.transform / toUserPublic', () => {
  it('returns masked PII for a normal user', () => {
    const dto = toUserPublic(buildUser());
    expect(dto.phone).toBe('010-****-5678');
    expect(dto.birthDate).toBe('1995-**-**');
  });

  it('preserves null phone as null', () => {
    const dto = toUserPublic(buildUser({ phone: null }));
    expect(dto.phone).toBeNull();
  });

  it('preserves null birthDate as null', () => {
    const dto = toUserPublic(buildUser({ birthDate: null }));
    expect(dto.birthDate).toBeNull();
  });

  it('coerces empty-string phone to null (mask helper consistency)', () => {
    const dto = toUserPublic(buildUser({ phone: '' }));
    expect(dto.phone).toBeNull();
  });

  it('rejects invalid calendar birthDate by masking to null', () => {
    // mask helper delegates Date.UTC normalize — invalid date returns null
    const dto = toUserPublic(buildUser({ birthDate: '1995-13-99' }));
    expect(dto.birthDate).toBeNull();
  });

  it('serializes Date fields to ISO 8601 strings', () => {
    const dto = toUserPublic(buildUser());
    expect(dto.createdAt).toBe('2026-03-01T09:00:00.000Z');
    expect(dto.updatedAt).toBe('2026-04-01T12:00:00.000Z');
    expect(dto.emailVerifiedAt).toBe('2026-04-01T12:00:00.000Z');
  });

  it('handles null nullable Date fields', () => {
    const dto = toUserPublic(buildUser({ emailVerifiedAt: null, withdrawnAt: null }));
    expect(dto.emailVerifiedAt).toBeNull();
    expect(dto.withdrawnAt).toBeNull();
  });

  it('serializes withdrawnAt when present', () => {
    const dto = toUserPublic(
      buildUser({ withdrawnAt: new Date('2026-05-01T00:00:00Z'), status: UserStatus.WITHDRAWN }),
    );
    expect(dto.withdrawnAt).toBe('2026-05-01T00:00:00.000Z');
    expect(dto.status).toBe(UserStatus.WITHDRAWN);
  });

  it('strips internal fields not defined in the schema (passwordHash, phoneKeyVersion, etc.)', () => {
    // 신규 PII 컬럼이나 내부 필드는 schema에 등록되지 않으면 zod가 자연 제거한다 (fail-closed).
    const tainted = {
      ...buildUser(),
      // 다음 필드는 schema 미정의 — 결과에 포함되어선 안 된다.
      passwordHash: '$2b$12$abcdefghijklmnopqrstuv',
      phoneKeyVersion: 1,
      birthDateKeyVersion: 1,
      failedLoginCount: 4,
      lockedUntil: new Date('2026-06-01T00:00:00Z'),
    } as unknown as UserPublicInput;
    const dto = toUserPublic(tainted) as Record<string, unknown>;
    expect(dto.passwordHash).toBeUndefined();
    expect(dto.phoneKeyVersion).toBeUndefined();
    expect(dto.birthDateKeyVersion).toBeUndefined();
    expect(dto.failedLoginCount).toBeUndefined();
    expect(dto.lockedUntil).toBeUndefined();
  });

  it('output only contains the documented public field set', () => {
    const dto = toUserPublic(buildUser());
    expect(Object.keys(dto).sort()).toEqual(
      [
        'birthDate',
        'createdAt',
        'email',
        'emailVerifiedAt',
        'id',
        'name',
        'phone',
        'status',
        'updatedAt',
        'withdrawnAt',
      ].sort(),
    );
  });

  it('throws on missing required field (defensive — server-side data integrity)', () => {
    const broken = { ...buildUser() } as Record<string, unknown>;
    delete broken.email;
    expect(() => toUserPublic(broken as UserPublicInput)).toThrow();
  });

  it('throws on malformed email (defensive — server-side data integrity)', () => {
    expect(() => toUserPublic(buildUser({ email: 'not-an-email' }))).toThrow();
  });

  it('throws when phone is given as a non-string non-null (e.g., Bytes leaked)', () => {
    // piiExtension이 복호화에 실패하면 phone이 Bytes/Buffer 그대로 남을 수 있다.
    // 본 schema가 입력 단계에서 거부하여 외부 응답에 raw bytes가 노출되는 시나리오를 차단.
    const tainted = { ...buildUser(), phone: Buffer.from([1, 2, 3]) as unknown as string };
    expect(() => toUserPublic(tainted)).toThrow();
  });

  it('throws when birthDate is given as a non-string non-null (symmetry with phone)', () => {
    // CANDID-031 D7 보강 — birthDate Buffer leak도 동일하게 거부 (defense-in-depth 대칭성).
    const tainted = { ...buildUser(), birthDate: Buffer.from([1, 2, 3]) as unknown as string };
    expect(() => toUserPublic(tainted)).toThrow();
  });

  it('is idempotent for the same input (pure transform)', () => {
    // Pure function 회귀 가드 — 동일 입력은 항상 동일 결과.
    const input = buildUser();
    expect(toUserPublic(input)).toEqual(toUserPublic(input));
  });

  it('throws a SYS_INTERNAL_ERROR-tagged error without leaking input values', () => {
    // CANDID-031 D7 ZodError 안전망 — parse 실패 시 입력 원본 값이 에러 메시지에 노출되지 않아야 한다.
    expect(() => toUserPublic(buildUser({ email: 'not-an-email' }))).toThrow(/SYS_INTERNAL_ERROR/);
    try {
      toUserPublic(buildUser({ email: 'not-an-email' }));
    } catch (e) {
      // 메시지에 평문 PII 또는 원본 입력 값이 포함되지 않는다 (path만 노출).
      const msg = (e as Error).message;
      expect(msg).not.toContain('not-an-email');
      expect(msg).toContain('email'); // path는 노출 OK
    }
  });

  it('schema export — direct parse usage works identically to toUserPublic for valid input', () => {
    const direct = userPublicSchema.parse(buildUser());
    const viaHelper = toUserPublic(buildUser());
    expect(direct).toEqual(viaHelper);
  });
});

// === CANDID-034 (CANDID-005 FU1) Step 4 — Application 공개 DTO serializer 테스트 ====

function buildApplication(
  overrides: Partial<ApplicationPublicInput> = {},
): ApplicationPublicInput {
  return {
    id: 42,
    applicationNumber: 'A-202605-00001',
    currentStage: 'SUBMITTED',
    result: 'IN_PROGRESS',
    submittedAt: new Date('2026-05-17T12:00:00Z'),
    withdrawnAt: null,
    applicantNameSnapshot: '홍길동',
    applicantEmailSnapshot: 'foo@bar.com',
    phoneSnapshot: '01012345678',
    birthDateSnapshot: '1995-03-15',
    addressSnapshot: '서울시 강남구 테헤란로 123',
    createdAt: new Date('2026-05-17T09:00:00Z'),
    updatedAt: new Date('2026-05-17T12:00:00Z'),
    ...overrides,
  };
}

describe('applicationPublicSchema.transform / toApplicationPublic (CANDID-034 Step 4)', () => {
  it('returns masked PII for all 5 snapshot fields', () => {
    const dto = toApplicationPublic(buildApplication());
    expect(dto.applicantNameSnapshot).toBe('홍**');
    expect(dto.applicantEmailSnapshot).toBe('f***@bar.com');
    expect(dto.phoneSnapshot).toBe('010-****-5678');
    expect(dto.birthDateSnapshot).toBe('1995-**-**');
    expect(dto.addressSnapshot).toBe('서울시 강남구 ***');
  });

  it('preserves null snapshot fields as null (no leak risk)', () => {
    const dto = toApplicationPublic(
      buildApplication({
        applicantNameSnapshot: null,
        applicantEmailSnapshot: null,
        phoneSnapshot: null,
        birthDateSnapshot: null,
        addressSnapshot: null,
      }),
    );
    expect(dto.applicantNameSnapshot).toBeNull();
    expect(dto.applicantEmailSnapshot).toBeNull();
    expect(dto.phoneSnapshot).toBeNull();
    expect(dto.birthDateSnapshot).toBeNull();
    expect(dto.addressSnapshot).toBeNull();
  });

  it('serializes all Date fields to ISO 8601 strings', () => {
    const dto = toApplicationPublic(buildApplication());
    expect(dto.submittedAt).toBe('2026-05-17T12:00:00.000Z');
    expect(dto.createdAt).toBe('2026-05-17T09:00:00.000Z');
    expect(dto.updatedAt).toBe('2026-05-17T12:00:00.000Z');
  });

  it('serializes nullable withdrawnAt: null → null, Date → ISO', () => {
    const dtoNull = toApplicationPublic(buildApplication({ withdrawnAt: null }));
    expect(dtoNull.withdrawnAt).toBeNull();
    const dtoDate = toApplicationPublic(
      buildApplication({ withdrawnAt: new Date('2026-05-20T15:30:00Z') }),
    );
    expect(dtoDate.withdrawnAt).toBe('2026-05-20T15:30:00.000Z');
  });

  it('preserves non-PII metadata fields (id, applicationNumber, currentStage, result)', () => {
    const dto = toApplicationPublic(buildApplication());
    expect(dto.id).toBe(42);
    expect(dto.applicationNumber).toBe('A-202605-00001');
    expect(dto.currentStage).toBe('SUBMITTED');
    expect(dto.result).toBe('IN_PROGRESS');
  });

  // PR #15 review M002 / Step 2 SSOT 회귀 가드 — 5개 *SnapshotKeyVersion이 응답에 노출 차단
  it('strips internal *SnapshotKeyVersion fields (5쌍 — fail-closed)', () => {
    // schema 미정의 키는 .strip()으로 제거. raw cast로 5개 key_version 동시 주입.
    const rawInput = {
      ...buildApplication(),
      applicantNameSnapshotKeyVersion: 1,
      applicantEmailSnapshotKeyVersion: 1,
      phoneSnapshotKeyVersion: 1,
      birthDateSnapshotKeyVersion: 1,
      addressSnapshotKeyVersion: 1,
    } as unknown as ApplicationPublicInput;
    const dto = toApplicationPublic(rawInput);
    expect('applicantNameSnapshotKeyVersion' in dto).toBe(false);
    expect('applicantEmailSnapshotKeyVersion' in dto).toBe(false);
    expect('phoneSnapshotKeyVersion' in dto).toBe(false);
    expect('birthDateSnapshotKeyVersion' in dto).toBe(false);
    expect('addressSnapshotKeyVersion' in dto).toBe(false);
  });

  it('strips arbitrary unknown internal fields (audit/timestamps/locks 등)', () => {
    const rawInput = {
      ...buildApplication(),
      internalAuditFlag: true,
      lockedUntil: new Date(),
      __secretField: 'hidden',
    } as unknown as ApplicationPublicInput;
    const dto = toApplicationPublic(rawInput);
    expect('internalAuditFlag' in dto).toBe(false);
    expect('lockedUntil' in dto).toBe(false);
    expect('__secretField' in dto).toBe(false);
  });

  it('throws SYS_INTERNAL_ERROR with path on invalid input shape (PII 원본 값 누락)', () => {
    const invalid = {
      // id 누락 + applicationNumber 타입 오류
      applicationNumber: 12345 as unknown as string,
      currentStage: 'SUBMITTED',
      result: 'IN_PROGRESS',
      submittedAt: new Date(),
      withdrawnAt: null,
      applicantNameSnapshot: '홍길동', // PII 원본 — 메시지에 노출되어선 안 됨
      applicantEmailSnapshot: null,
      phoneSnapshot: null,
      birthDateSnapshot: null,
      addressSnapshot: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ApplicationPublicInput;
    try {
      toApplicationPublic(invalid);
      throw new Error('expected throw');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('SYS_INTERNAL_ERROR');
      expect(msg).toContain('application public serialization failed');
      // path는 포함, PII 원본 값은 미포함 회귀 가드
      expect(msg).not.toContain('홍길동');
    }
  });

  it('schema direct parse usage works identically to toApplicationPublic helper', () => {
    const direct = applicationPublicSchema.parse(buildApplication());
    const viaHelper = toApplicationPublic(buildApplication());
    expect(direct).toEqual(viaHelper);
  });

  it('1-char name preserves as-is (maskName boundary, no leak)', () => {
    const dto = toApplicationPublic(buildApplication({ applicantNameSnapshot: 'A' }));
    expect(dto.applicantNameSnapshot).toBe('A');
  });

  it('2-token address preserves as-is (maskAddress boundary)', () => {
    const dto = toApplicationPublic(buildApplication({ addressSnapshot: '서울시 강남구' }));
    expect(dto.addressSnapshot).toBe('서울시 강남구');
  });
});
