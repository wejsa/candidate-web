import { ERROR_CATALOG, errorStatus } from '@/lib/errors/codes';
import type { ErrorCode } from '@/lib/errors/codes';

// CANDID-007 Step 1 — 도메인 예외 클래스.
// 비즈니스 규칙 위반·예상된 실패는 AppError를 throw한다. 전역 핸들러(handleApiError, Step 2)가
// AppError를 표준 에러 응답으로 변환한다 — code/status/message는 모두 클라이언트 노출 안전.
// 예상치 못한 오류(일반 Error)는 핸들러가 500 SYS_INTERNAL_ERROR로 수렴시킨다.

/** 에러 응답 `details` 배열의 단일 항목 — 필드 단위 디버깅 정보. */
export interface ErrorDetail {
  field: string;
  reason: string;
}

export interface AppErrorOptions {
  /** 카탈로그 기본 메시지를 덮어쓸 사용자 메시지. */
  message?: string;
  /** 필드 단위 상세 — 검증 실패 등에서 사용. */
  details?: ErrorDetail[];
  /** 원인 예외 — 서버 로깅용. 응답 본문에는 노출되지 않는다. */
  cause?: unknown;
}

/**
 * 예상된 도메인 실패를 나타내는 예외. 항상 카탈로그 `ErrorCode`를 동반하며
 * status는 카탈로그에서 파생되고 message는 카탈로그 기본값 또는 override를 사용한다.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ErrorDetail[];

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? ERROR_CATALOG[code].message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = errorStatus(code);
    this.details = options.details;
  }
}

/** 임의의 값이 AppError 인스턴스인지 판별 — 전역 핸들러의 분기 가드. */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
