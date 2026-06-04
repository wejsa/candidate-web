-- CANDID-053 Step 1 (M-A) — RBAC 역할 컬럼 (A안: 내부 흡수).
--
-- 비파괴적 additive 변경: 신규 enum + NOT NULL DEFAULT 컬럼.
--   - 기존 행 백필은 DEFAULT 'CANDIDATE'로 자동 충족 (별도 UPDATE 불필요).
--   - PG11+ 에서 NOT NULL + 상수 DEFAULT 동시 추가는 메타데이터-only(테이블 rewrite 없음) → 락 안전.
--   - destructive 아님 → COUNT(*) guard 불필요(파괴적 변경 전용 패턴).
-- enum 값 emit(권한 검사/승격)은 후속 스텝의 애플리케이션 코드에서 수행.

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CANDIDATE', 'RECRUITER', 'ADMIN');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'CANDIDATE';
