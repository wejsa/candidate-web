-- CANDID-005 Step 1: 지원서 핵심 도메인 — applications + application_drafts + application_number_sequences + 6 enum
--
-- PRD §3.3.4~3.3.5 + ERD §3.2 + BR-APP-01,02,05 / BR-PII-03 기반. 신규 테이블만 생성하므로
-- destructive migration guard 대상 외(L-001 N/A). 신규 enum 6종은 후속 Step에서도 참조됨.
-- applications PII snapshot 컬럼은 NULLABLE Bytes로 사전 정의 — 암복호화 wiring/테스트는 CANDID-005-FU1.
--
-- 생성 순서: enum → application_number_sequences (참조 없음) → applications → application_drafts.

-- CreateEnum
CREATE TYPE "ApplicationResult" AS ENUM ('IN_PROGRESS', 'PASSED', 'FAILED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "StageType" AS ENUM ('SUBMITTED', 'DOC_REVIEW', 'INTERVIEW_1', 'INTERVIEW_2', 'OFFER', 'HIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InterviewScheduleStatus" AS ENUM ('SCHEDULED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PortfolioLinkType" AS ENUM ('GITHUB', 'NOTION', 'BLOG', 'LINKEDIN', 'FIGMA', 'ETC');

-- CreateEnum
CREATE TYPE "VirusScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'APPLICATION_SUBMIT', 'APPLICATION_WITHDRAW', 'PII_VIEW', 'PASSWORD_CHANGE', 'USER_WITHDRAWN');

-- CreateTable
CREATE TABLE "application_number_sequences" (
    "year_month" VARCHAR(6) NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_number_sequences_pkey" PRIMARY KEY ("year_month")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" SERIAL NOT NULL,
    "application_number" VARCHAR(20) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "job_posting_id" INTEGER NOT NULL,
    "current_stage" "StageType" NOT NULL DEFAULT 'SUBMITTED',
    "result" "ApplicationResult" NOT NULL DEFAULT 'IN_PROGRESS',
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "withdrawn_at" TIMESTAMP(3),
    "applicant_name_snapshot" BYTEA,
    "applicant_name_key_version" SMALLINT DEFAULT 1,
    "applicant_email_snapshot" BYTEA,
    "applicant_email_key_version" SMALLINT DEFAULT 1,
    "phone_snapshot" BYTEA,
    "phone_snapshot_key_version" SMALLINT DEFAULT 1,
    "birth_date_snapshot" BYTEA,
    "birth_date_snapshot_key_version" SMALLINT DEFAULT 1,
    "address_snapshot" BYTEA,
    "address_snapshot_key_version" SMALLINT DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_drafts" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "job_posting_id" INTEGER NOT NULL,
    "payload_json" JSONB NOT NULL,
    "last_saved_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "applications_application_number_key" ON "applications"("application_number");

-- CreateIndex (BR-APP-01 활성 지원서 부분 UNIQUE — L-013 적용)
-- 철회 후 재지원 허용: result <> 'WITHDRAWN'인 row만 unique 제약.
CREATE UNIQUE INDEX "uk_applications_active" ON "applications"("user_id", "job_posting_id")
  WHERE "result" <> 'WITHDRAWN';

-- CreateIndex
CREATE INDEX "idx_applications_user_submitted" ON "applications"("user_id", "submitted_at" DESC);

-- CreateIndex
CREATE INDEX "idx_applications_posting_result" ON "applications"("job_posting_id", "result");

-- CreateIndex
CREATE UNIQUE INDEX "uk_drafts_user_posting" ON "application_drafts"("user_id", "job_posting_id");

-- CreateIndex (BR-FILE-06 30일 배치 정리 대상 스캔용)
CREATE INDEX "idx_drafts_last_saved" ON "application_drafts"("last_saved_at");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_posting_id_fkey" FOREIGN KEY ("job_posting_id") REFERENCES "job_postings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_job_posting_id_fkey" FOREIGN KEY ("job_posting_id") REFERENCES "job_postings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
