import {
  encryptApplicationPiiSnapshotInput,
  encryptUserPiiInput,
  type ApplicationPiiSnapshotPlaintextInput,
  type UserPiiPlaintextInput,
} from '@/lib/prisma/extends';

import { getTestPrisma } from './prisma';

// CANDID-035 Step 2 — 최소 fixture helpers (Step 1에서 line-limit 차단으로 위임됨).
//
// 통합 테스트가 Application 생성을 위해 필요한 부모 row(User + JobCategory + JobPosting)를
// 일관된 형태로 생성한다. User PII는 항상 `encryptUserPiiInput`을 거쳐 평문 string이 BYTEA
// 컬럼에 노출되지 않도록 한다 (CANDID-031 D8 런타임 가드 회피 부담을 줄임).
//
// 회귀 발견 (CANDID-035 통합 테스트가 처음 트리거 — L-019 in-task self-correction):
// `encryptUserPiiInput` 반환 타입의 `Buffer`가 Prisma 6 Bytes 컬럼의
// `Exact<Uint8Array<ArrayBuffer>>`와 호환되지 않아 `prisma.user.create({ data:
// { ...encryptUserPiiInput(...) } })` 직접 호출 시 TS 컴파일 실패한다.
// 본 helper는 임시 우회로 `new Uint8Array(length) + .set(buf)` 변환을 수행한다.
// 근본 정정(`encryptPiiWithVersion` / `UserPiiEncryptedInput` 반환 타입 widening +
// 단위 테스트 `.equals()` 정리)은 별도 micro fix로 위임 (CANDID-035 retro Action Items).
//
// 통합 테스트 데이터는 모두 *익명 더미*: 실제 사용자가 입력할 만한 형식(`010-XXXX-XXXX`)을
// 회피하기 위해 `09099999999` / `19000101` 등 운영 데이터와 명확히 구분되는 값 사용 권고
// (security review MINOR — Step 2 컨벤션 도입).

let counter = 0;
function uniq(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

// `new Uint8Array(buf)`는 `Uint8Array<ArrayBufferLike>`를 반환해 Prisma 6 Exact와 안 맞음.
// `new Uint8Array(length)`는 `Uint8Array<ArrayBuffer>`로 type되므로 길이로 할당 후 set 복사.
function toUint8(b: Buffer | null | undefined): Uint8Array<ArrayBuffer> | null | undefined {
  if (b === null || b === undefined) return b;
  const out = new Uint8Array(b.length);
  out.set(b);
  return out as Uint8Array<ArrayBuffer>;
}

export async function seedUser(overrides?: { email?: string }) {
  const prisma = getTestPrisma();
  const piiInput = encryptUserPiiInput({
    phone: '09099999999', // anonymous dummy — 운영 010-XXXX-XXXX 형식 회피
    birthDate: '1900-01-01',
  });
  return prisma.user.create({
    data: {
      email: overrides?.email ?? `${uniq('user')}@example.test`,
      passwordHash: '$2a$12$abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuv',
      name: '테스트 유저',
      phone: toUint8(piiInput.phone),
      phoneKeyVersion: piiInput.phoneKeyVersion,
      birthDate: toUint8(piiInput.birthDate),
      birthDateKeyVersion: piiInput.birthDateKeyVersion,
    },
  });
}

export async function seedJobPosting() {
  const prisma = getTestPrisma();
  const category = await prisma.jobCategory.create({
    data: {
      name: uniq('엔지니어링'),
      slug: uniq('eng'),
    },
  });
  return prisma.jobPosting.create({
    data: {
      title: '시니어 백엔드 엔지니어',
      jobCategoryId: category.id,
      employmentType: 'FULL_TIME',
      careerLevel: 'EXPERIENCED',
      contentHtml: '<p>채용공고 본문</p>',
      opensAt: new Date(),
      closesAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: 'OPEN',
    },
  });
}

// Prisma create-compatible 형태로 5쌍 snapshot 암호화 결과를 반환.
// `encryptApplicationPiiSnapshotInput`의 Buffer 반환을 5쌍 모두 toUint8 변환.
export function encryptApplicationSnapshotForPrisma(
  plaintext: ApplicationPiiSnapshotPlaintextInput,
) {
  const e = encryptApplicationPiiSnapshotInput(plaintext);
  return {
    applicantNameSnapshot: toUint8(e.applicantNameSnapshot),
    applicantNameSnapshotKeyVersion: e.applicantNameSnapshotKeyVersion,
    applicantEmailSnapshot: toUint8(e.applicantEmailSnapshot),
    applicantEmailSnapshotKeyVersion: e.applicantEmailSnapshotKeyVersion,
    phoneSnapshot: toUint8(e.phoneSnapshot),
    phoneSnapshotKeyVersion: e.phoneSnapshotKeyVersion,
    birthDateSnapshot: toUint8(e.birthDateSnapshot),
    birthDateSnapshotKeyVersion: e.birthDateSnapshotKeyVersion,
    addressSnapshot: toUint8(e.addressSnapshot),
    addressSnapshotKeyVersion: e.addressSnapshotKeyVersion,
  };
}

// Prisma create-compatible 형태로 User PII 2쌍 암호화 결과를 반환.
// `encryptApplicationSnapshotForPrisma` 미러 — `encryptUserPiiInput`의 Buffer 반환을 toUint8 변환.
// CANDID-032 User 통합 테스트(round-trip / write-guard)에서 재사용.
export function encryptUserPiiInputForPrisma(plaintext: UserPiiPlaintextInput) {
  const e = encryptUserPiiInput(plaintext);
  return {
    phone: toUint8(e.phone),
    phoneKeyVersion: e.phoneKeyVersion,
    birthDate: toUint8(e.birthDate),
    birthDateKeyVersion: e.birthDateKeyVersion,
  };
}

export function buildApplicationNumber(): string {
  // BR-APP-05: A-YYYYMM-NNNNN. 테스트에선 시퀀스 회피 위해 timestamp 기반 5자리.
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const tail = String(Date.now() % 100000).padStart(5, '0');
  return `A-${yyyymm}-${tail}`;
}
