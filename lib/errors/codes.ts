// CANDID-007 Step 1 — 에러 코드 카탈로그 (SSOT).
// 표준 에러 응답의 `code`는 이 카탈로그에 정의된 불변 문자열 상수만 사용한다.
// 도메인 접두어: AUTH_ / USER_ / JOB_ / APP_ / FILE_ / SYS_ (CLAUDE.md 에러 코드 체계).
// 각 코드는 기본 HTTP status와 사용자 친화적 한국어 message를 가진다.
// 순수 TS만 사용 — Edge/Node 양 런타임 호환 유지. node: 모듈·Prisma 의존 추가 금지.

export interface ErrorCodeSpec {
  /** 기본 HTTP 상태 코드 — AppError가 별도 status를 받지 않으면 이 값을 사용. */
  status: number;
  /** 사용자 노출용 기본 한국어 메시지 — AppError가 override 가능. */
  message: string;
}

export const ERROR_CATALOG = {
  // 인증 — AUTH_
  AUTH_INVALID_CREDENTIALS: { status: 401, message: '이메일 또는 비밀번호가 올바르지 않습니다.' },
  AUTH_ACCOUNT_LOCKED: {
    status: 429,
    message: '로그인 시도가 많아 계정이 일시 잠겼습니다. 잠시 후 다시 시도해 주세요.',
  },
  AUTH_EMAIL_NOT_VERIFIED: { status: 403, message: '이메일 인증이 필요합니다.' },
  AUTH_TOKEN_INVALID: { status: 401, message: '유효하지 않은 인증 토큰입니다.' },
  AUTH_TOKEN_EXPIRED: { status: 401, message: 'Access 토큰이 만료되었습니다.' },
  AUTH_REFRESH_INVALID: {
    status: 401,
    message: '유효하지 않은 Refresh 토큰입니다. 다시 로그인해 주세요.',
  },
  AUTH_REFRESH_EXPIRED: {
    status: 401,
    message: 'Refresh 토큰이 만료되었습니다. 다시 로그인해 주세요.',
  },
  AUTH_FORBIDDEN: { status: 403, message: '이 작업을 수행할 권한이 없습니다.' },
  // CANDID-010 Step 3 — 이메일 인증 토큰 검증/재발송
  AUTH_VERIFICATION_TOKEN_INVALID: {
    status: 400,
    message: '유효하지 않은 이메일 인증 토큰입니다.',
  },
  AUTH_VERIFICATION_TOKEN_EXPIRED: {
    status: 410,
    message: '이메일 인증 토큰이 만료되었습니다. 재발송을 요청해 주세요.',
  },
  AUTH_VERIFICATION_RESEND_COOLDOWN: {
    status: 429,
    message: '재발송 요청이 너무 빠릅니다. 60초 후 다시 시도해 주세요.',
  },
  // CANDID-037 Step 2 — 이미 인증된 사용자의 재발송 시도 (멱등 응답이 아닌 명시적 분기)
  AUTH_EMAIL_ALREADY_VERIFIED: {
    status: 409,
    message: '이미 인증된 이메일입니다. 재발송이 필요하지 않습니다.',
  },
  // CANDID-012 Step 1 — OAuth2 소셜 로그인 (Google/GitHub, US-AUTH-003)
  AUTH_OAUTH_STATE_INVALID: {
    status: 400,
    message: '소셜 로그인 요청이 만료되었거나 변조되었습니다. 다시 시도해 주세요.',
  },
  AUTH_OAUTH_PROVIDER_ERROR: {
    status: 502,
    message: '소셜 로그인 제공자와 통신에 실패했습니다. 잠시 후 다시 시도해 주세요.',
  },
  AUTH_OAUTH_EMAIL_TAKEN: {
    status: 409,
    message: '이미 가입된 이메일입니다. 이메일 로그인 후 마이페이지에서 소셜 연동을 진행해 주세요.',
  },
  // 사용자가 동의 화면에서 명시적으로 거부한 정상 비즈니스 분기 — 클라이언트 요청 결함(400)이 아닌
  // 처리 가능했으나 의도적 종결(422). 모니터링 anomaly detection 노이즈 차단.
  AUTH_OAUTH_USER_DENIED: {
    status: 422,
    message: '소셜 로그인 권한 요청이 거부되었습니다.',
  },

  // 사용자 — USER_
  USER_EMAIL_DUPLICATED: { status: 409, message: '이미 가입된 이메일입니다.' },
  USER_NOT_FOUND: { status: 404, message: '사용자를 찾을 수 없습니다.' },

  // 공고 — JOB_
  JOB_NOT_FOUND: { status: 404, message: '채용 공고를 찾을 수 없습니다.' },
  JOB_NOT_OPEN: { status: 422, message: '아직 지원할 수 없는 공고입니다.' },
  JOB_CLOSED: { status: 422, message: '지원이 마감된 공고입니다.' },

  // 지원 — APP_
  APP_ALREADY_SUBMITTED: { status: 409, message: '이미 지원한 공고입니다.' },
  APP_DEADLINE_PASSED: { status: 422, message: '지원 마감일이 지난 공고입니다.' },
  APP_DRAFT_CONFLICT: {
    status: 409,
    message: '다른 곳에서 임시저장이 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
  },
  // CANDID-015 Step 1 — 만 14세 미만 지원 차단 (BR-PII-05)
  APP_USER_UNDER_MIN_AGE: {
    status: 422,
    message: '만 14세 미만은 지원할 수 없습니다.',
  },
  // CANDID-017 Step 1 — Draft 미존재 또는 권한 없음 (정보 누출 회피 위해 두 케이스 단일 코드).
  APP_DRAFT_NOT_FOUND: {
    status: 404,
    message: '임시 저장된 지원서를 찾을 수 없습니다.',
  },
  // CANDID-018 — 제출 전 검증 실패 (이력서 누락 / 필수 필드 / 동의 false 등 — details에 항목 표시)
  APP_SUBMIT_INCOMPLETE: {
    status: 422,
    message: '지원서 제출 조건이 충족되지 않았습니다.',
  },
  // CANDID-019 Step 2 review C1 fix — 면접 일정 미존재 / 권한 없음 / CANCELLED (단일 코드, 정보 누출 회피)
  APP_INTERVIEW_NOT_FOUND: {
    status: 404,
    message: '면접 일정을 찾을 수 없습니다.',
  },

  // 파일 — FILE_
  FILE_SIZE_EXCEEDED: { status: 422, message: '허용된 파일 크기를 초과했습니다.' },
  FILE_TYPE_NOT_ALLOWED: { status: 422, message: '허용되지 않은 파일 형식입니다.' },
  FILE_UPLOAD_FAILED: { status: 500, message: '파일 업로드에 실패했습니다.' },
  // CANDID-016 Step 2: 활성 첨부 1건 partial UNIQUE 충돌 + 메타 미존재.
  FILE_ALREADY_EXISTS: {
    status: 409,
    message: '이미 첨부된 파일이 있습니다. 교체 후 다시 시도해 주세요.',
  },
  FILE_NOT_FOUND: { status: 404, message: '파일을 찾을 수 없습니다.' },

  // 시스템 — SYS_
  SYS_INTERNAL_ERROR: { status: 500, message: '서버 내부 오류가 발생했습니다.' },
  SYS_DEPENDENCY_UNAVAILABLE: {
    status: 503,
    message: '일시적으로 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  },
  SYS_VALIDATION_FAILED: { status: 400, message: '입력값이 올바르지 않습니다.' },
  // CANDID-009 Step 2 — Rate Limit / CSRF Origin 차단
  SYS_RATE_LIMITED: {
    status: 429,
    message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  },
  SYS_FORBIDDEN_ORIGIN: {
    status: 403,
    message: '허용되지 않은 출처의 요청입니다.',
  },
} as const satisfies Record<string, ErrorCodeSpec>;

/** 카탈로그에 정의된 모든 에러 코드의 유니온 — 클라이언트 분기 처리용 불변 상수. */
export type ErrorCode = keyof typeof ERROR_CATALOG;

/** 에러 코드의 기본 HTTP status를 반환. */
export function errorStatus(code: ErrorCode): number {
  return ERROR_CATALOG[code].status;
}

/** 에러 코드의 기본 사용자 메시지를 반환. */
export function errorMessage(code: ErrorCode): string {
  return ERROR_CATALOG[code].message;
}
