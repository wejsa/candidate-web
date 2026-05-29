-- CANDID-020 Step 1 — 비밀번호 재설정 토큰 평문 → sha256 token_hash 격상 (US-AUTH-004).
--
-- 배경:
--   password_reset_tokens는 CANDID-003 생성 이후 평문 `token VARCHAR(255)` 상태로 방치됨.
--   같은 인증 도메인의 email_verifications(CANDID-010) / refresh_tokens(CANDID-006)는
--   이미 sha256 해시 저장으로 hardening 됨. 평문 토큰은 DB 유출 시 즉시 계정 탈취 채널이 되므로
--   high-entropy random 토큰을 sha256(CHAR(64))으로 저장하도록 격상한다.
--
-- L-001 학습: 평문 → sha256은 역산 불가(백필 불가) → 기존 row가 있으면 마이그레이션을 중단한다.
--   password_reset 흐름은 아직 미구현 상태라 운영 데이터 0건 예상.
--   dev/staging seed에 reset 토큰이 있으면 guard가 중단시키므로 수동 정리가 필요하다
--   (활성 reset 토큰은 보안 토큰이라 폐기·재발급 무방).
-- L-029 학습: CREATE INDEX는 비 CONCURRENTLY — Prisma migrate의 트랜잭션 wrap과 호환된다.

-- destructive guard: 평문 token row가 남아 있으면 중단.
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM "password_reset_tokens";
  IF v_count > 0 THEN
    RAISE EXCEPTION
      'CANDID-020 destructive migration aborted: password_reset_tokens has % row(s) (expected 0). '
      '평문 token → sha256 백필 불가 — 수동 정리 필요.',
      v_count;
  END IF;
END $$;

-- 평문 token 컬럼 제거 → token_hash(sha256, CHAR(64)) 추가.
-- DROP COLUMN이 UNIQUE 인덱스를 cascade 제거하지만, 명시 DROP으로 의도를 분명히 한다.
DROP INDEX IF EXISTS "password_reset_tokens_token_key";
ALTER TABLE "password_reset_tokens" DROP COLUMN "token";
-- guard 통과로 0건 보장 → NOT NULL 컬럼을 default 없이 안전하게 추가.
ALTER TABLE "password_reset_tokens" ADD COLUMN "token_hash" CHAR(64) NOT NULL;
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens" ("token_hash");

-- user당 활성(미소진) reset 토큰 1건 강제 — 재발송 TOCTOU race 차단 (CANDID-036 패턴).
-- 정상 흐름(기존 활성 토큰 consumed_at=now() → 새 토큰 INSERT)은 충돌하지 않는다.
-- race 시 두 번째 INSERT가 P2002로 차단 → 라우터 catch에서 적절한 AUTH_ 코드로 매핑(Step 2).
CREATE UNIQUE INDEX "uk_password_reset_active_per_user"
  ON "password_reset_tokens" ("user_id")
  WHERE "consumed_at" IS NULL;

-- 만료 토큰 정리 배치(CANDID-029)용.
CREATE INDEX "idx_password_reset_tokens_expires" ON "password_reset_tokens" ("expires_at");
