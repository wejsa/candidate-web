import { z } from 'zod';
import { UserStatus } from '@prisma/client';
import { maskBirthDate, maskPhone } from '@/lib/pii/mask';

// CANDID-031 (D7) — PII-safe response DTO serializer.
//
// 목적: Route Handler가 prisma.user.* 결과를 외부 응답으로 직접 직렬화하는 경로를 차단한다.
// piiExtension(result extension)이 phone/birthDate를 평문 string으로 복호화하므로,
// 외부 응답 직전에 본 serializer를 통과시켜 마스킹 + 내부 필드 제거 + Date→ISO 변환을
// 단일 진입점에서 강제한다.
//
// 사용:
//   const user = await prisma.user.findUnique({ where: { id } });
//   return Response.json(toUserPublic(user));
//
// 입력 컨벤션:
//   - phone/birthDate: piiExtension 복호화 결과 평문 string 또는 null
//   - password_hash, phone_key_version, birth_date_key_version, failed_login_count, locked_until
//     같은 내부 필드는 schema에 정의되지 않아 zod `.parse()`에서 자연 제거(strip)된다.

/**
 * 외부 응답에 노출되는 User 공개 DTO의 입력 schema.
 *
 * 본 schema에 정의되지 않은 필드(passwordHash 등)는 zod 기본 동작(strip)으로 제거된다.
 * 신규 PII 컬럼이 도입될 때 본 schema에 명시적으로 추가하기 전까지는 외부 응답에 포함되지 않는다.
 *
 * `.strip()` 명시 호출 — 미정의 필드는 누설 차단(fail-closed). 향후 `.passthrough()`로 바뀌면
 * 변화가 명시적으로 드러나 리뷰에서 감지 가능.
 */
export const userPublicInputSchema = z
  .object({
    id: z.number().int(),
    email: z.string().email(),
    name: z.string(),
    phone: z.string().nullable(),
    birthDate: z.string().nullable(),
    emailVerifiedAt: z.date().nullable(),
    status: z.nativeEnum(UserStatus),
    withdrawnAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strip();

/**
 * piiExtension으로 phone/birthDate가 string으로 복호화된 User 객체의 형태.
 * Route Handler 등 호출자는 `Prisma.UserGetPayload<{}>` 결과를 그대로 본 schema에 통과시킨다.
 *
 * 입력 타입은 `userPublicInputSchema`에 anchor — transform 추가/변경에도 입력 contract가
 * 흔들리지 않으며, 신규 transform 추가 시 InputSchema가 SSOT로 유지된다.
 */
export type UserPublicInput = z.infer<typeof userPublicInputSchema>;

/**
 * 입력 검증 + 마스킹 + ISO 직렬화를 단일 transform으로 수행하는 schema.
 * `.parse()`는 입력 형태가 어긋날 때 ZodError를 throw — `toUserPublic`이 PII 원본 값을 메시지에서
 * 제거하고 안전한 에러로 변환한다(전역 에러 핸들러 도입 전까지의 자체 안전망).
 */
export const userPublicSchema = userPublicInputSchema.transform((u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  phone: maskPhone(u.phone),
  birthDate: maskBirthDate(u.birthDate),
  emailVerifiedAt: u.emailVerifiedAt === null ? null : u.emailVerifiedAt.toISOString(),
  status: u.status,
  withdrawnAt: u.withdrawnAt === null ? null : u.withdrawnAt.toISOString(),
  createdAt: u.createdAt.toISOString(),
  updatedAt: u.updatedAt.toISOString(),
}));

/**
 * 외부 응답에 노출되는 최종 DTO 형태. 모든 PII는 마스킹되고 Date는 ISO 문자열이다.
 */
export type UserPublicDTO = z.output<typeof userPublicSchema>;

/**
 * User → 공개 DTO 단일 진입점. 모든 외부 응답 직렬화는 본 함수를 거쳐야 한다.
 *
 * - `phone` / `birthDate`: maskPhone / maskBirthDate를 통과하여 마스킹 형태(`010-****-5678`,
 *   `1995-**-**`)로 변환. 입력이 빈 문자열이거나 무효 형식이면 mask 헬퍼가 null 반환.
 * - `passwordHash` / `phoneKeyVersion` / `birthDateKeyVersion` / `failedLoginCount` /
 *   `lockedUntil`: schema 미정의로 자연 제거.
 * - 모든 `Date` 필드: `toISOString()` 으로 직렬화.
 *
 * 신규 PII 컬럼 추가 시: schema에 명시 등록 + 마스킹 헬퍼 적용. 등록 누락 시 응답에서 자연
 * 제거되어 *fail-closed* 동작(누설 차단 우선).
 *
 * ZodError 안전망: parse 실패 시 입력 원본 값을 메시지에서 제외하고 path만 노출한다.
 * 전역 에러 핸들러가 본 에러를 SYS_INTERNAL_ERROR로 매핑하기 전까지의 보완.
 *
 * 호출 컨텍스트: 본 DTO는 *자기 정보 조회* 응답을 가정한다(email/withdrawnAt 평문 포함).
 * 타인 프로필 조회 등 다른 audience가 도입되면 별도 schema(`userPublicMinimalSchema` 등)
 * 분리가 필요하다 — 본 PR 범위 외 (follow-up task).
 */
export function toUserPublic(user: UserPublicInput): UserPublicDTO {
  try {
    return userPublicSchema.parse(user);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const paths = e.errors.map((x) => x.path.join('.')).join(',');
      throw new Error(`SYS_INTERNAL_ERROR: user public serialization failed (paths=${paths})`);
    }
    throw e;
  }
}
