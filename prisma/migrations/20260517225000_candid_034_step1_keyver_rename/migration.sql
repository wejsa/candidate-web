-- CANDID-034 (CANDID-005 FU1) Step 1: PII snapshot key_version 컬럼명 일관화.
--
-- CANDID-005 Step 1에서 도입한 applications 테이블 PII snapshot key_version 컬럼 5개 중
-- name/email 2개만 `_snapshot_` 토큰을 누락하고 있어 일관성이 깨져 있었음.
-- 본 마이그레이션은 두 컬럼명을 `_snapshot_key_version` 형식으로 RENAME하여
-- 후속 wiring(CANDID-034 Step 2~4)이 SSOT derive 패턴을 일관 적용할 수 있게 한다.
--
-- 본 마이그레이션은 dev-only RENAME 변경입니다.
-- CANDID-005 머지 직후이며 applications 테이블에 운영 데이터가 아직 없음을 가정.
-- 운영 진입 후에는 4단계 무중단 절차(view 추가 → backfill → swap → drop)로 전환해야 함.
--
-- L-001 적용: applications 테이블에 row가 있으면 마이그레이션 abort.
-- _base/conventions/database.md "Destructive migration guard" 참조.

-- Guard: applications 테이블에 1건 이상의 데이터가 있으면 본 마이그레이션 차단.
-- prisma migrate deploy가 환경 구분 없이 적용하더라도 운영/스테이징 데이터 손실 방지.
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "applications") > 0 THEN
    RAISE EXCEPTION 'CANDID-034 destructive migration aborted: applications 테이블에 % rows 존재. 무중단 절차로 전환하세요.',
      (SELECT COUNT(*) FROM "applications");
  END IF;
END $$;

ALTER TABLE "applications"
  RENAME COLUMN "applicant_name_key_version" TO "applicant_name_snapshot_key_version";

ALTER TABLE "applications"
  RENAME COLUMN "applicant_email_key_version" TO "applicant_email_snapshot_key_version";
