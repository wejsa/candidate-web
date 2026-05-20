// CANDID-007 — lib/errors 공개 API barrel.
// 소비자는 `@/lib/errors`에서 import한다 (개별 파일 경로 대신).

export { ERROR_CATALOG, errorMessage, errorStatus } from '@/lib/errors/codes';
export type { ErrorCode, ErrorCodeSpec } from '@/lib/errors/codes';
export { AppError, isAppError } from '@/lib/errors/app-error';
export type { AppErrorOptions, ErrorDetail } from '@/lib/errors/app-error';
export { errorResponse, handleApiError, withErrorHandler } from '@/lib/errors/response';
export type { ErrorResponseBody, ErrorResponseOptions } from '@/lib/errors/response';
