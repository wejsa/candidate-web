-- CANDID-018 Step 1 — IdempotencyKey 테이블 (BR-APP-06).
-- 클라이언트 Idempotency-Key 헤더 + user_id로 격리. 24시간 TTL.
-- composite PK (user_id, key) — 사용자 간 충돌 격리.

CREATE TABLE "idempotency_keys" (
    "user_id" INTEGER NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "response_json" JSONB NOT NULL,
    "response_status" SMALLINT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pk_idempotency_keys" PRIMARY KEY ("user_id", "key")
);

-- CANDID-029 야간 배치 정리용 (expires_at < now() 삭제)
CREATE INDEX "idx_idempotency_expires" ON "idempotency_keys" ("expires_at");

-- FK: User 삭제 시 idempotency_keys도 CASCADE (BR-PII-03 회원 탈퇴 정리)
ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "fk_idempotency_keys_user"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
