// CANDID-024 Step 2 — 프로필 수정 폼 순수 헬퍼 (US-MY-004).
//
// 클라이언트 컴포넌트(ProfileEditForm)의 분기 로직을 순수 함수로 분리해 단위 테스트로 회귀 가드한다.
// (컴포넌트는 이 헬퍼 + fetch 배선만 담당 — 로직 SSOT는 본 파일.)

export const PROFILE_EDIT_LABELS = {
  heading: '프로필 수정',
  nameLabel: '이름',
  phoneLabel: '연락처',
  phonePlaceholder: '010-1234-5678 (변경 시에만 입력)',
  submit: '저장',
  submitting: '저장 중…',
  saved: '프로필이 저장되었습니다.',
  noChange: '변경 사항이 없습니다.',
  errorInvalid: '입력값을 다시 확인해 주세요.',
  errorRateLimited: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  errorSession: '세션이 만료되었습니다. 다시 로그인해 주세요.',
  errorGeneric: '잠시 후 다시 시도해 주세요.',
} as const;

export interface ProfileUpdatePayload {
  name?: string;
  phone?: string;
}

/**
 * 폼 입력 → PATCH 페이로드. 변경된 항목만 포함한다 (부분 갱신).
 * - name: trim 후 비어있지 않고 원본과 다르면 포함.
 * - phone: 입력이 비어있지 않으면 포함 (현재 값은 마스킹 표시라 비교 불가 → 입력 시 항상 전송).
 */
export function buildProfileUpdatePayload(
  input: { name: string; phone: string },
  original: { name: string },
): ProfileUpdatePayload {
  const payload: ProfileUpdatePayload = {};
  const trimmedName = input.name.trim();
  if (trimmedName !== '' && trimmedName !== original.name) {
    payload.name = trimmedName;
  }
  const trimmedPhone = input.phone.trim();
  if (trimmedPhone !== '') {
    payload.phone = trimmedPhone;
  }
  return payload;
}

export function isEmptyPayload(payload: ProfileUpdatePayload): boolean {
  return payload.name === undefined && payload.phone === undefined;
}

/** PATCH 응답 status → 사용자 안내 메시지. */
export function classifyProfileUpdateError(status: number): string {
  if (status === 400 || status === 422) return PROFILE_EDIT_LABELS.errorInvalid;
  if (status === 429) return PROFILE_EDIT_LABELS.errorRateLimited;
  if (status === 401 || status === 404) return PROFILE_EDIT_LABELS.errorSession;
  return PROFILE_EDIT_LABELS.errorGeneric;
}
