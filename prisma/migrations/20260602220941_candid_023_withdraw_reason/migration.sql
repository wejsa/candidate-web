-- CANDID-023 — 지원 철회 사유 컬럼 (US-MY-003)
-- "철회 사유(선택 입력) 수집" 요구사항 충족용. Application과 1:1.
--
-- 변경: 비파괴 nullable ADD COLUMN 만.
-- L-001 destructive guard 미적용 — ADD COLUMN은 기존 row를 변경하지 않음 (PG11+ 메타데이터 전용, 테이블 재작성 없음).
-- L-029 no CONCURRENTLY 준수 (prisma migrate deploy의 트랜잭션 wrap 호환).
-- 롤백: ALTER TABLE "applications" DROP COLUMN "withdraw_reason";

-- 1. applications.withdraw_reason 컬럼 추가 (선택 입력 자유 텍스트, 최대 500자)
ALTER TABLE "applications" ADD COLUMN "withdraw_reason" VARCHAR(500);
