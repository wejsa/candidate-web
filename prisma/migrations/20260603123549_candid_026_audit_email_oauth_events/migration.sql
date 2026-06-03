-- CANDID-026 Step 4 — AuditEventType enum 확장 (이메일 인증 + OAuth 연결/해제).
--
-- 비파괴적 추가 전용(ALTER TYPE ... ADD VALUE). 기존 enum 값/데이터에 영향 없음.
-- 주의: enum 값 추가는 별도 마이그레이션으로 분리한다 — 동일 마이그레이션에서 새 값을 즉시
--       데이터로 참조(INSERT/비교)하면 PostgreSQL이 거부한다(L: "Enum 확장은 destructive").
--       본 마이그레이션은 값 추가만 수행하고, 실제 사용(emit)은 애플리케이션 코드에서 한다.

ALTER TYPE "AuditEventType" ADD VALUE 'EMAIL_VERIFIED';
ALTER TYPE "AuditEventType" ADD VALUE 'EMAIL_VERIFICATION_RESENT';
ALTER TYPE "AuditEventType" ADD VALUE 'OAUTH_LINKED';
ALTER TYPE "AuditEventType" ADD VALUE 'OAUTH_UNLINKED';
