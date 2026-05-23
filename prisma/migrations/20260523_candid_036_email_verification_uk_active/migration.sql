-- CANDID-036: 이메일 인증 보안 hardening.
-- Step 1 — email_verifications 활성 토큰 부분 UNIQUE 격상 (deep defense).
--
-- 배경 (CANDID-010 PR #33 H001/H009):
-- resendVerificationEmail은 쿨다운 검증(SELECT)이 트랜잭션 *외부*에 있어 TOCTOU race window 존재:
--   T1: SELECT active (cooldown 통과)
--   T2: SELECT active (cooldown 통과)
--   T1: invalidate + INSERT  ← 2개 활성 토큰
--   T2: invalidate + INSERT
--
-- 본 마이그레이션은 기존 *인덱스*(`idx_email_verifications_active`, 부분 인덱스)를
-- 동일 조건의 **부분 UNIQUE 제약**으로 격상한다. T2 INSERT가 P2002로 자연 차단됨 →
-- 라우터 catch에서 `AUTH_VERIFICATION_RESEND_COOLDOWN`(기존 코드 재사용)으로 매핑.
--
-- L-001 학습 반영: destructive 마이그레이션 SQL에 COUNT(*) > 0 guard 동반.
-- (이 경우는 destructive가 아니지만, 사전 무결성 위배 시 마이그레이션 차단 — 운영 안전 가드)

DO $$
DECLARE
  v_dup_count INT;
BEGIN
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT user_id
    FROM "email_verifications"
    WHERE consumed_at IS NULL
    GROUP BY user_id
    HAVING COUNT(*) > 1
  ) AS dups;
  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'CANDID-036 migration aborted: % user(s) have multiple active email_verifications rows. '
      'resendVerificationEmail 정상 흐름 위배 — 수동 정리 필요.',
      v_dup_count;
  END IF;
END $$;

-- 기존 부분 인덱스 → 부분 UNIQUE 격상.
-- DROP INDEX는 비어있을 수도 있는 인덱스라 IF EXISTS로 안전.
DROP INDEX IF EXISTS "idx_email_verifications_active";

-- 부분 UNIQUE: user당 활성(미소진) 토큰 1건 이하.
-- resendVerificationEmail의 invalidate(consumed_at=now) → INSERT 정상 흐름은 영향 없음.
-- race 시 INSERT 충돌 → P2002 → AUTH_VERIFICATION_RESEND_COOLDOWN으로 매핑(Step 2).
CREATE UNIQUE INDEX "uk_email_verifications_active_per_user"
  ON "email_verifications" ("user_id")
  WHERE "consumed_at" IS NULL;
