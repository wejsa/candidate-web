-- CANDID-053 Step 1 (M-B) — AuditEventType enum 확장 (운영자 RBAC 백오피스 감사).
--
-- 비파괴적 추가 전용(ALTER TYPE ... ADD VALUE). 기존 enum 값/데이터에 영향 없음.
-- 주의: enum 값 추가는 별도 마이그레이션으로 분리한다(M-A와 분리) — 동일 마이그레이션/트랜잭션에서
--       새 값을 즉시 데이터로 참조(INSERT/비교)하면 PostgreSQL이 거부한다. 본 마이그레이션은 값
--       추가만 수행하고, 실제 사용(emit)은 Step 3~7 애플리케이션 코드에서 한다.
-- enum ADD VALUE는 비가역(PostgreSQL은 값 제거 불가) — 롤백은 "더 이상 emit 안 함"으로 충분.

ALTER TYPE "AuditEventType" ADD VALUE 'ROLE_GRANTED';
ALTER TYPE "AuditEventType" ADD VALUE 'ROLE_REVOKED';
ALTER TYPE "AuditEventType" ADD VALUE 'JOB_POSTING_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'JOB_POSTING_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'JOB_POSTING_STATUS_CHANGED';
ALTER TYPE "AuditEventType" ADD VALUE 'APPLICATION_STAGE_CHANGED';
ALTER TYPE "AuditEventType" ADD VALUE 'INTERVIEW_SCHEDULED';
ALTER TYPE "AuditEventType" ADD VALUE 'INTERVIEW_UPDATED';
