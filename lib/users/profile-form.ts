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

// === CANDID-024 Step 3 — 비밀번호 변경 폼 헬퍼 ====================================

export const PASSWORD_CHANGE_LABELS = {
  heading: '비밀번호 변경',
  currentLabel: '현재 비밀번호',
  newLabel: '새 비밀번호',
  confirmLabel: '새 비밀번호 확인',
  submit: '비밀번호 변경',
  submitting: '변경 중…',
  done: '비밀번호가 변경되었습니다. 보안을 위해 다시 로그인해 주세요.',
  errorMismatch: '새 비밀번호 확인이 일치하지 않습니다.',
  errorWeak: '비밀번호는 10자 이상, 영문 대/소·숫자·특수문자 중 3종 이상이어야 합니다.',
  errorCurrentInvalid: '현재 비밀번호가 올바르지 않습니다.',
  errorRateLimited: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  errorSession: '세션이 만료되었습니다. 다시 로그인해 주세요.',
  errorGeneric: '잠시 후 다시 시도해 주세요.',
} as const;

/** 비밀번호 변경 응답 status → 사용자 안내 메시지. */
export function classifyPasswordChangeError(status: number): string {
  if (status === 401) return PASSWORD_CHANGE_LABELS.errorCurrentInvalid; // AUTH_INVALID_CREDENTIALS
  if (status === 400) return PASSWORD_CHANGE_LABELS.errorWeak; // zod 강도/형식
  if (status === 422) return PASSWORD_CHANGE_LABELS.errorCurrentInvalid; // RECONFIRM_REQUIRED
  if (status === 429) return PASSWORD_CHANGE_LABELS.errorRateLimited;
  if (status === 404) return PASSWORD_CHANGE_LABELS.errorSession;
  return PASSWORD_CHANGE_LABELS.errorGeneric;
}

// === CANDID-024 Step 4 — 소셜 계정 관리(해제) 헬퍼 ================================

export const SOCIAL_ACCOUNTS_LABELS = {
  heading: '연결된 소셜 계정',
  unlink: '연결 해제',
  unlinking: '해제 중…',
  notLinked: '미연결',
  // CANDID-024 Step 5 — link-add OAuth 플로우로 이동하는 연결 버튼.
  connect: '연결 추가',
  unlinked: '연결이 해제되었습니다.',
  errorLastAuth: '마지막 로그인 수단은 해제할 수 없습니다. 비밀번호를 먼저 설정해 주세요.',
  errorNotLinked: '연결되지 않은 소셜 계정입니다.',
  errorSession: '세션이 만료되었습니다. 다시 로그인해 주세요.',
  errorGeneric: '잠시 후 다시 시도해 주세요.',
} as const;

/** 소셜 연결 해제(DELETE) 응답 status → 사용자 안내 메시지. */
export function classifyUnlinkError(status: number): string {
  if (status === 409) return SOCIAL_ACCOUNTS_LABELS.errorLastAuth; // USER_LAST_AUTH_METHOD
  if (status === 404) return SOCIAL_ACCOUNTS_LABELS.errorNotLinked; // USER_PROVIDER_NOT_LINKED
  if (status === 401) return SOCIAL_ACCOUNTS_LABELS.errorSession;
  return SOCIAL_ACCOUNTS_LABELS.errorGeneric;
}
