-- CANDID-022 — 회원 탈퇴 + 익명화/철회 정책 (GDPR 잊혀질 권리)
-- US-AUTH-005, BR-PII-03 (분기), BR-PII-04 (1년 자동 파기 — CANDID-029 위임), BR-AUTH-05 (RefreshToken revoke)
--
-- 변경: 비파괴 ADD COLUMN + ADD ENUM VALUE + CREATE INDEX 만.
-- L-001 destructive guard 미적용 — ADD COLUMN/INDEX/ENUM은 기존 row를 변경하지 않음.
-- ALTER TYPE ... ADD VALUE는 Prisma migrate가 트랜잭션 wrap을 분리 적용 (PG 제약), 일반 CREATE INDEX는 트랜잭션 wrap 가능.
-- L-029 no CONCURRENTLY 준수 (prisma migrate deploy의 트랜잭션 wrap 호환).

-- 1. users.anonymized_at 컬럼 추가
ALTER TABLE "users" ADD COLUMN "anonymized_at" TIMESTAMP(3);

-- 2. AuditEventType enum 확장 (탈퇴 분기별 상세 이벤트)
ALTER TYPE "AuditEventType" ADD VALUE 'USER_ANONYMIZED';
ALTER TYPE "AuditEventType" ADD VALUE 'USER_HARD_DELETED';

-- 3. BR-PII-04 1년 파기 배치(CANDID-029) 스캔용 인덱스 — anonymizedAt NOT NULL row만 대상으로 충분.
CREATE INDEX "idx_users_anonymized_at" ON "users"("anonymized_at");
