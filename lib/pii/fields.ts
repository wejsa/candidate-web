// CANDID-034 (CANDID-005 FU1) Step 2 — PII SSOT.
//
// 모듈 곳곳에 하드코딩되는 PII 필드 목록을 단일 진입점에서 관리한다. 신규 PII 컬럼 추가 시
// 본 파일 한 곳만 갱신하면 암호화 헬퍼, 직렬화 schema, 런타임 가드, 응답 마스킹이 동일한
// 필드 집합을 자동으로 참조한다.
//
// 출처: _base/conventions/database.md "민감 컬럼(PII) 메타데이터는 SSOT 상수에서 derive".

/**
 * users 테이블의 실시간 PII 필드. CANDID-008/030/031 wiring이 보호한다.
 * 신규 User PII 컬럼 추가 시 본 배열에 등록 → encryptUserPiiInput / assertUserPiiInputShape /
 * userPublicSchema가 자동으로 신규 필드를 인식한다.
 */
export const USER_PII_FIELDS = ['phone', 'birthDate'] as const;
export type UserPiiField = (typeof USER_PII_FIELDS)[number];

/**
 * applications 테이블의 PII snapshot 필드 (BR-PII-03 익명화 보존).
 *
 * 지원 시점의 PII를 사용자 PII 변경에 영향받지 않게 *분리 저장*하는 패턴 (L-017).
 * 사용자 탈퇴/이메일 변경 후에도 application은 제출 당시 값을 보존한다.
 *
 * 각 필드는 schema에서 다음 컬럼 페어로 매핑된다 (CANDID-034 Step 1에서 5쌍 모두
 * `_snapshot_key_version` suffix로 일관화 완료):
 *
 *   applicantNameSnapshot   → applicant_name_snapshot   + applicant_name_snapshot_key_version
 *   applicantEmailSnapshot  → applicant_email_snapshot  + applicant_email_snapshot_key_version
 *   phoneSnapshot           → phone_snapshot            + phone_snapshot_key_version
 *   birthDateSnapshot       → birth_date_snapshot       + birth_date_snapshot_key_version
 *   addressSnapshot         → address_snapshot          + address_snapshot_key_version
 */
export const APPLICATION_PII_SNAPSHOT_FIELDS = [
  'applicantNameSnapshot',
  'applicantEmailSnapshot',
  'phoneSnapshot',
  'birthDateSnapshot',
  'addressSnapshot',
] as const;
export type ApplicationPiiSnapshotField = (typeof APPLICATION_PII_SNAPSHOT_FIELDS)[number];

/**
 * SSOT-derived key_version 컬럼 필드명. `${field}KeyVersion` 규약을 따른다.
 * Step 1 schema rename으로 5쌍 모두 일관 적용 가능.
 */
export type ApplicationPiiSnapshotKeyVersionField = `${ApplicationPiiSnapshotField}KeyVersion`;
