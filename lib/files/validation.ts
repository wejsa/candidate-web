import { z } from 'zod';
import { AppError } from '@/lib/errors';

// CANDID-016 Step 2 — 이력서 첨부 입력 검증 (US-APP-003 + BR-FILE-01~03).
// 확장자 + MIME 화이트리스트 이중 검증 + 10MB 상한 + 경로 문자 거부 + UTF-8 길이 가드.
// validation 통과 후 lib/files/storage.ts buildResumeKey가 UUID 재명명 → 검증과 재명명 SSOT.

// BR-FILE-01: PDF/DOCX/DOC/HWP/HWPX 화이트리스트. 5개. 소문자.
// MIME-확장자 정합은 ALLOWED 매핑으로 강제 (호출자가 확장자만 신뢰하지 않도록).
export const RESUME_ALLOWED_EXTS = ['pdf', 'docx', 'doc', 'hwp', 'hwpx'] as const;
export type ResumeExt = (typeof RESUME_ALLOWED_EXTS)[number];

// 확장자 → 허용 MIME 집합. 클라이언트가 잘못된 MIME을 보내면 거부.
// HWP는 운영체제별로 application/x-hwp / application/haansofthwp / application/octet-stream까지
// 다양하게 보낼 수 있어 마지막을 폴백으로 허용 — 단, 확장자가 .hwp/.hwpx인 경우에 한정.
const RESUME_MIME_BY_EXT: Record<ResumeExt, readonly string[]> = {
  pdf: ['application/pdf'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  doc: ['application/msword', 'application/vnd.ms-word'],
  hwp: ['application/x-hwp', 'application/haansofthwp', 'application/octet-stream'],
  hwpx: ['application/hwp+zip', 'application/octet-stream'],
};

// BR-FILE-02: 최대 10MB. SDK/응답 시 BigInt 변환은 호출자 책임.
export const RESUME_MAX_BYTES = 10 * 1024 * 1024;

// BR-FILE-03: 경로 문자(`/`, `\`, `..`) 거부 + null byte + control char 거부 + UTF-8 255 bytes 이하.
// VARCHAR(255)는 'characters' 기준이지만 PostgreSQL은 byte 기준이 더 안전 — TextEncoder로 측정.
function validateFilenameShape(name: string): true {
  if (name.length === 0) throw new AppError('SYS_VALIDATION_FAILED', { message: '파일명이 비어 있습니다.' });
  if (name.includes('/') || name.includes('\\')) {
    throw new AppError('SYS_VALIDATION_FAILED', { message: '파일명에 경로 문자를 포함할 수 없습니다.' });
  }
  if (name.includes('..')) {
    throw new AppError('SYS_VALIDATION_FAILED', { message: '파일명에 ".."을 포함할 수 없습니다.' });
  }
  // 0x00 + control chars 0x01~0x1f (탭/개행 포함).
  if (/[\x00-\x1f]/.test(name)) {
    throw new AppError('SYS_VALIDATION_FAILED', { message: '파일명에 제어 문자를 포함할 수 없습니다.' });
  }
  const bytes = new TextEncoder().encode(name).length;
  if (bytes > 255) {
    throw new AppError('SYS_VALIDATION_FAILED', { message: '파일명이 너무 깁니다(UTF-8 기준 255바이트 이하).' });
  }
  return true;
}

function extractExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot < 0) return '';
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * 확장자 + MIME 이중 검증.
 * 위반 시 422 FILE_TYPE_NOT_ALLOWED throw — 호출자에서 catch 불필요(전역 핸들러 처리).
 */
export function assertResumeContentType(originalFilename: string, contentType: string): ResumeExt {
  validateFilenameShape(originalFilename);
  const ext = extractExtension(originalFilename);
  if (!(RESUME_ALLOWED_EXTS as readonly string[]).includes(ext)) {
    throw new AppError('FILE_TYPE_NOT_ALLOWED', {
      message: `허용된 파일 형식이 아닙니다: .${ext || '(확장자 없음)'}`,
    });
  }
  const allowedMimes = RESUME_MIME_BY_EXT[ext as ResumeExt];
  // case-insensitive — 일부 클라이언트가 대문자 MIME을 보냄.
  if (!allowedMimes.some((m) => m.toLowerCase() === contentType.toLowerCase())) {
    throw new AppError('FILE_TYPE_NOT_ALLOWED', {
      message: `확장자(.${ext})와 일치하지 않는 MIME 형식입니다.`,
    });
  }
  return ext as ResumeExt;
}

export function assertResumeFileSize(fileSize: number): void {
  if (!Number.isInteger(fileSize) || fileSize <= 0) {
    throw new AppError('SYS_VALIDATION_FAILED', { message: 'fileSize는 양의 정수여야 합니다.' });
  }
  if (fileSize > RESUME_MAX_BYTES) {
    throw new AppError('FILE_SIZE_EXCEEDED', {
      message: `최대 ${RESUME_MAX_BYTES / 1024 / 1024}MB까지 업로드 가능합니다.`,
    });
  }
}

// API 요청 스키마 — Route Handler에서 zod parse 후 비즈니스로 위임.
export const PresignRequestSchema = z.object({
  draftId: z.number().int().positive(),
  originalFilename: z.string().min(1).max(512),
  contentType: z.string().min(1).max(127),
  fileSize: z.number().int().positive(),
});
export type PresignRequest = z.infer<typeof PresignRequestSchema>;

// checksumSha256: 64-char lowercase hex (SHA-256).
export const ConfirmRequestSchema = z.object({
  draftId: z.number().int().positive(),
  storedPath: z.string().min(1).max(500),
  originalFilename: z.string().min(1).max(512),
  contentType: z.string().min(1).max(127),
  fileSize: z.number().int().positive(),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/, 'SHA-256 64자 lowercase hex'),
});
export type ConfirmRequest = z.infer<typeof ConfirmRequestSchema>;
