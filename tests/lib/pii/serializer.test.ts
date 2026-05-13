import { describe, expect, it } from 'vitest';
import { UserStatus } from '@prisma/client';
import { toUserPublic, userPublicSchema, type UserPublicInput } from '@/lib/pii/serializer';

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

  it('schema export — direct parse usage works identically to toUserPublic', () => {
    const direct = userPublicSchema.parse(buildUser());
    const viaHelper = toUserPublic(buildUser());
    expect(direct).toEqual(viaHelper);
  });
});
