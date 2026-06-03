import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { encryptUserPiiInput } from '@/lib/prisma/extends';
import { AppError } from '@/lib/errors';
import { maskPhone, maskBirthDate } from '@/lib/pii/mask';
import type { ProfileDto, ProfileProviderName } from '@/lib/users/types';
import type { ProfileUpdateBody } from '@/lib/users/schema';

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
    // user.phone/birthDate: piiExtension이 복호화한 평문 string | null. 마스킹으로만 노출.
    phoneMasked: maskPhone(user.phone),
    birthDateMasked: maskBirthDate(user.birthDate),
    hasPassword: user.passwordHash !== null,
    providers: user.authProviders.map((p) => ({
      provider: toProviderName(p.provider),
      linkedAt: p.linkedAt.toISOString(),
    })),
  };
}

// CANDID-024 Step 2 — 프로필 수정 (이름/연락처) 서비스 (PATCH /api/v1/users/me).
//
// 부분 갱신: 전달된 필드만 UPDATE. phone은 'phone' 키가 있을 때만 encryptUserPiiInput를 경유해
// phone + phone_key_version을 원자적으로 set(L-007 top-level write, 미수정 시 재암호화 churn 회피).
// updateMany + status≠WITHDRAWN 가드로 탈퇴/미존재 계정 수정을 차단(count 0 → USER_NOT_FOUND).
export async function updateProfile(userId: number, input: ProfileUpdateBody): Promise<ProfileDto> {
  const data: Prisma.UserUpdateManyMutationInput = {};
  if (input.name !== undefined) {
    data.name = input.name;
  }
  if ('phone' in input) {
    // phone 입력 시에만 암호화 컬럼 동시 갱신. encryptUserPiiInput가 normalizePhone로 형식 재검증.
    Object.assign(data, encryptUserPiiInput({ phone: input.phone ?? null }));
  }
  if ('birthDate' in input) {
    // birthDate 입력 시에만 암호화 컬럼 동시 갱신. encryptUserPiiInput가 normalizeBirthDate로 형식 재검증.
    Object.assign(data, encryptUserPiiInput({ birthDate: input.birthDate ?? null }));
  }

  const result = await prisma.user.updateMany({
    where: { id: userId, NOT: { status: 'WITHDRAWN' } },
    data,
  });
  if (result.count === 0) {
    throw new AppError('USER_NOT_FOUND');
  }

  // 갱신 후 마스킹 DTO로 환원하여 반환 (클라이언트 즉시 반영).
  return getProfile(userId);
}
