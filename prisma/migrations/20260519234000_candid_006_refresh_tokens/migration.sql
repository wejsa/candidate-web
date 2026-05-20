-- CANDID-006: Refresh Token 화이트리스트 도입
-- BR-AUTH-05 (비밀번호 변경 시 모든 Refresh Token 무효화) 지원을 위해 서버 측 인덱싱 필수.
-- 토큰 자체는 sha256 해시로 저장 (Char(64) hex). rotation reuse detection 로직은 CANDID-021 위임.

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "family_id" UUID NOT NULL,
    "rotation_counter" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" VARCHAR(50),
    "user_agent" VARCHAR(500),
    "ip_address" INET,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (UNIQUE — O(1) 토큰 조회 + 충돌 fail-fast)
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex (BR-AUTH-05 일괄 revoke — user_id + revoked_at IS NULL 부분 매칭)
CREATE INDEX "idx_refresh_tokens_user_active" ON "refresh_tokens"("user_id", "revoked_at");

-- CreateIndex (TTL 정리 배치 — CANDID-029)
CREATE INDEX "idx_refresh_tokens_expires" ON "refresh_tokens"("expires_at");

-- CreateIndex (CANDID-021 reuse detection chain 추적)
CREATE INDEX "idx_refresh_tokens_family" ON "refresh_tokens"("family_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
