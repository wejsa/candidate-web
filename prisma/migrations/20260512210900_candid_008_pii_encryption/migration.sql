-- CANDID-008: PII 컬럼 암호화 (AES-256-GCM) — phone, birth_date를 BYTEA로 변경.
--
-- 본 마이그레이션은 dev-only destructive 변경입니다.
-- CANDID-003 머지 후 운영/스테이징 데이터가 아직 없는 단계에서 실행한다고 가정.
-- 운영 진입 후에는 4단계 무중단 절차(M1 add → M2 backfill → M3 deploy → M4 drop+rename)를
-- 별도 마이그레이션으로 진행해야 함 (docs/security/pii-encryption.md 참조).
--
-- 변경 요약:
--   - users.phone: VARCHAR(20) → BYTEA (AES-256-GCM ciphertext)
--   - users.birth_date: DATE → BYTEA (AES-256-GCM ciphertext)
--   - 신규: users.phone_key_version SMALLINT DEFAULT 1
--   - 신규: users.birth_date_key_version SMALLINT DEFAULT 1

ALTER TABLE "users"
  DROP COLUMN "phone",
  DROP COLUMN "birth_date",
  ADD COLUMN "phone" BYTEA,
  ADD COLUMN "phone_key_version" SMALLINT DEFAULT 1,
  ADD COLUMN "birth_date" BYTEA,
  ADD COLUMN "birth_date_key_version" SMALLINT DEFAULT 1;
