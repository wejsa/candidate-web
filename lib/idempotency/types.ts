// CANDID-018 Step 1 — 멱등성 키 도메인 타입 (BR-APP-06).

export interface IdempotencyRecord {
  responseJson: unknown;
  responseStatus: number;
  requestHash: string;
  expiresAt: Date;
}

/** Idempotency-Key 헤더의 표준 24시간 TTL (밀리초). */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
