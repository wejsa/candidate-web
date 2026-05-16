-- CANDID-004: 공고 조회 도메인 — job_categories + job_postings + job_posting_questions
--
-- PRD §3.3.3 + ERD §3.2 + BR-JOB-01~04 준수. 신규 테이블만 생성하므로
-- destructive migration guard 대상 외(L-001 N/A). 어드민에서 작성·관리하며
-- 지원자 측에서는 조회 전용. content_html은 어드민 측 sanitize 결과 저장.
--
-- 생성 순서: enum → job_categories → job_postings → job_posting_questions (FK 의존성 준수).

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'CONTRACT', 'INTERN');

-- CreateEnum
CREATE TYPE "CareerLevel" AS ENUM ('NEW', 'EXPERIENCED', 'ANY');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'SELECT', 'MULTI_SELECT');

-- CreateTable
CREATE TABLE "job_categories" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_postings" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "job_category_id" INTEGER NOT NULL,
    "employment_type" "EmploymentType" NOT NULL,
    "career_level" "CareerLevel" NOT NULL,
    "content_html" TEXT NOT NULL,
    "opens_at" TIMESTAMP(3) NOT NULL,
    "closes_at" TIMESTAMP(3),
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "view_count" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_posting_questions" (
    "id" SERIAL NOT NULL,
    "job_posting_id" INTEGER NOT NULL,
    "question_text" TEXT NOT NULL,
    "question_type" "QuestionType" NOT NULL DEFAULT 'LONG_TEXT',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "max_length" INTEGER,
    "options_json" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_posting_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_categories_name_key" ON "job_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "job_categories_slug_key" ON "job_categories"("slug");

-- CreateIndex
CREATE INDEX "idx_job_categories_active_sort" ON "job_categories"("active", "sort_order");

-- CreateIndex
CREATE INDEX "idx_job_postings_status_closes_at" ON "job_postings"("status", "closes_at");

-- CreateIndex
CREATE INDEX "idx_job_postings_category" ON "job_postings"("job_category_id");

-- CreateIndex
CREATE INDEX "idx_job_postings_opens_at_status" ON "job_postings"("opens_at", "status");

-- CreateIndex
CREATE INDEX "idx_jpq_posting_sort" ON "job_posting_questions"("job_posting_id", "sort_order");

-- AddForeignKey
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_job_category_id_fkey" FOREIGN KEY ("job_category_id") REFERENCES "job_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_posting_questions" ADD CONSTRAINT "job_posting_questions_job_posting_id_fkey" FOREIGN KEY ("job_posting_id") REFERENCES "job_postings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
