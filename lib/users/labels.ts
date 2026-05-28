// CANDID-022 Step 4 — UI 노출 라벨/문구 SSOT (한국어 고정 — PRD §4.3 i18n 1단계 한국어).
//
// 위치 분리 근거: page.tsx / Form / Modal 3 위치에서 동일 문구 재사용 → 회귀 방지 + 라벨 길이 단위 테스트로 가시화.
// i18n 키 분리 미적용 — 영어 대응은 PRD P2 (Phase 4+). 키 추가 시 본 객체에 entry 추가.

export const WITHDRAW_LABELS = Object.freeze({
  pageTitle: '회원 탈퇴',
  pageDescription: '탈퇴 절차를 안내드립니다. 진행 중인 지원서 유무에 따라 처리 방식이 다릅니다.',
  noticeHeading: '안내',
  noticeAnonymizedBranch:
    '진행 중인 지원이 있으면 채용 평가 기록은 채용 종료 시까지 익명화 보존됩니다 (1년 후 자동 파기).',
  noticeHardDeleteBranch: '진행 중인 지원이 없으면 계정과 관련 데이터가 즉시 삭제됩니다.',
  noticeIrreversible: '탈퇴 처리는 되돌릴 수 없습니다.',
  noticeRefreshTokenRevoke: '탈퇴 즉시 모든 로그인 세션이 종료됩니다.',
  formHeading: '본인 확인',
  passwordFieldLabel: '비밀번호 (재확인)',
  passwordFieldPlaceholder: '현재 비밀번호 입력',
  socialOnlyNotice: '소셜 계정 전용 사용자입니다. 현재 탈퇴는 고객센터를 통해 진행해 주세요.',
  reasonFieldLabel: '탈퇴 사유 (선택, 최대 500자)',
  reasonFieldPlaceholder: '운영 개선을 위한 자유 입력',
  submitButton: '탈퇴 진행',
  cancelButton: '취소',
  modalHeading: '정말 탈퇴하시겠습니까?',
  modalConfirmButton: '탈퇴 확정',
  modalCancelButton: '돌아가기',
  successRedirectMessage: '탈퇴 처리가 완료되었습니다.',
  errorPasswordMismatch: '비밀번호가 일치하지 않습니다.',
  errorPasswordRequired: '비밀번호를 입력해 주세요.',
  errorAlreadyWithdrawn: '이미 탈퇴된 계정입니다.',
  errorRateLimited: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  errorGeneric: '탈퇴 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.',
} as const satisfies Record<string, string>);
// M_test fix (review): satisfies Record<string, string>로 모든 값 string 타입 컴파일 가드.
// 신규 키 추가 시 typo/잘못된 타입 즉시 감지 (`as const` literal 보존 + 타입 강제 결합).

export type WithdrawLabelKey = keyof typeof WITHDRAW_LABELS;
