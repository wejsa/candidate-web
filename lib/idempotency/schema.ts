// CANDID-018 Step 1 — Idempotency-Key 헤더 검증 zod 스키마.
// BR-APP-06: 클라이언트는 제출 시 헤더로 키 전송 — UUID v4 형식 강제.

import { z } from 'zod';

// UUID v4 (RFC 4122) — version 4, variant 8/9/a/b
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Idempotency-Key 헤더 값 검증.
 * - UUID v4만 허용 (사용자 임의 문자열 차단 — 충돌/공격 가능성 회피)
 * - 길이 36자 고정
 */
export const IdempotencyKeySchema = z
  .string()
  .length(36, 'Idempotency-Key는 36자 UUID v4여야 합니다.')
  .regex(UUID_V4_RE, 'Idempotency-Key는 UUID v4 형식이어야 합니다.');
