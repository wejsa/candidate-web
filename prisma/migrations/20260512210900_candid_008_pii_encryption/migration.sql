-- CANDID-008: PII 컬럼 암호화 (AES-256-GCM) — phone, birth_date를 BYTEA로 변경.
--
-- 본 마이그레이션은 dev-only destructive 변경입니다.
-- CANDID-003 머지 후 운영/스테이징 데이터가 아직 없는 단계에서 실행한다고 가정.
-- 운영 진입 후에는 4단계 무중단 절차(M1 add → M2 backfill → M3 deploy → M4 drop+rename)를
-- 별도 마이그레이션으로 진행해야 함 (docs/security/pii-encryption.md 참조).
--
-- CANDID-030 (FU1): 운영 데이터 보호 guard 추가 — users 테이블에 row가 있으면 마이그레이션 abort.
-- _base/conventions/database.md "Destructive migration guard" 참조.
--
-- 변경 요약:
--   - users.phone: VARCHAR(20) → BYTEA (AES-256-GCM ciphertext)
--   - users.birth_date: DATE → BYTEA (AES-256-GCM ciphertext)
--   - 신규: users.phone_key_version SMALLINT DEFAULT 1
--   - 신규: users.birth_date_key_version SMALLINT DEFAULT 1

-- Guard: users 테이블에 1건 이상의 데이터가 있으면 본 마이그레이션 차단.
-- prisma migrate deploy가 환경 구분 없이 적용하더라도 운영/스테이징 데이터 손실 방지.
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "users") > 0 THEN
    RAISE EXCEPTION 'CANDID-008 destructive migration aborted: users 테이블에 % rows 존재. 무중단 절차(M1~M4)로 전환하세요.',
      (SELECT COUNT(*) FROM "users");
  END IF;
END $$;

ALTER TABLE "users"
  DROP COLUMN "phone",
  DROP COLUMN "birth_date",
  ADD COLUMN "phone" BYTEA,
  ADD COLUMN "phone_key_version" SMALLINT DEFAULT 1,
  ADD COLUMN "birth_date" BYTEA,
  ADD COLUMN "birth_date_key_version" SMALLINT DEFAULT 1;
