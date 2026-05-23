-- CANDID-010: 이메일 회원가입 API + 이메일 인증 (US-AUTH-001).
-- db-designer 권고 4건 반영:
--  1. users 동의 컬럼 4종 추가 (개인정보보호법 §22 감사 추적)
--  2. email_verifications.token 평문 → sha256 해시 (DB 유출 시 계정 탈취 차단)
--  3. 활성 토큰 부분 인덱스 + 만료 인덱스
--  4. BR-PII-05 옵션 C (age_confirmed_at)

-- L-001 학습: destructive 마이그레이션 guard.
-- 본 마이그레이션은 token 컬럼을 교체하나, CANDID-010이 회원가입 API 자체를 처음 도입하므로
-- 기존 email_verifications row는 0건 — backfill/guard 불요. 배포 직전 row count 재확인 필수.

-- === users: 동의/연령 확인 컬럼 4종 추가 ===
ALTER TABLE "users" ADD COLUMN "terms_agreed_at"     TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "privacy_agreed_at"   TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "marketing_agreed_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "age_confirmed_at"    TIMESTAMP(3);

-- === email_verifications: token → token_hash ===
-- 기존 UNIQUE 인덱스 제거 (Prisma가 자동 생성한 email_verifications_token_key)
DROP INDEX IF EXISTS "email_verifications_token_key";
ALTER TABLE "email_verifications" DROP COLUMN "token";
ALTER TABLE "email_verifications" ADD COLUMN "token_hash" CHAR(64) NOT NULL;
CREATE UNIQUE INDEX "email_verifications_token_hash_key" ON "email_verifications"("token_hash");

-- === 인덱스 보강 ===
-- 부분 인덱스: 활성(미소진) 토큰 조회 빈번 — userId 단독보다 효율.
-- Prisma @@index 미지원 → raw SQL.
CREATE INDEX "idx_email_verifications_active"
  ON "email_verifications"("user_id")
  WHERE "consumed_at" IS NULL;

-- 만료 토큰 정리 배치용 (TTL cleanup job).
CREATE INDEX "idx_email_verifications_expires"
  ON "email_verifications"("expires_at");
