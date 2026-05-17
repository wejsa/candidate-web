-- CANDID-005 Step 2: 첨부/응답 도메인 — application_answers + resume_files + portfolio_links
-- + job_posting_questions.archived_at soft-archive 컬럼 추가 (L-015 R1 종결)
--
-- PRD §3.3.6~3.3.7 + ERD §3.2 (application_answers는 ERD 도출) + BR-FILE-01~07 / BR-APP-04 기반.
-- 신규 테이블만 + ALTER ADD COLUMN(NULLABLE) → destructive 아님(L-001 N/A).
--
-- L-015 종결: application_answers.question_id RESTRICT + JobPostingQuestion.archived_at NULLABLE.
-- 어드민 측 질문 hard-delete 불가 (RESTRICT) — archived_at만 set하여 신규 응답 차단(앱 레이어 where 필터).
--
-- 생성 순서: ALTER job_posting_questions → 신규 3 테이블 (참조 순서: application_answers → resume_files → portfolio_links).

-- AlterTable: L-015 R1 종결 — JobPostingQuestion soft-archive
ALTER TABLE "job_posting_questions" ADD COLUMN "archived_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "application_answers" (
    "id" SERIAL NOT NULL,
    "application_id" INTEGER NOT NULL,
    "question_id" INTEGER NOT NULL,
    "answer_text" TEXT,
    "answer_options_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_files" (
    "id" SERIAL NOT NULL,
    "owner_user_id" INTEGER NOT NULL,
    "application_id" INTEGER,
    "draft_id" INTEGER,
    "original_filename" VARCHAR(255) NOT NULL,
    "stored_path" VARCHAR(500) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "file_size" BIGINT NOT NULL,
    "checksum_sha256" VARCHAR(64) NOT NULL,
    "virus_scan_status" "VirusScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanned_at" TIMESTAMP(3),
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_files_pkey" PRIMARY KEY ("id"),
    -- XOR: 첨부는 application_id 또는 draft_id 중 정확히 한쪽만 NOT NULL.
    -- Draft → Submit 전이 시 트랜잭션 내 SET application_id + SET draft_id = NULL (BR-TX-01).
    CONSTRAINT "chk_resume_files_app_xor_draft" CHECK (("application_id" IS NULL) <> ("draft_id" IS NULL))
);

-- CreateTable
CREATE TABLE "portfolio_links" (
    "id" SERIAL NOT NULL,
    "application_id" INTEGER,
    "draft_id" INTEGER,
    "link_type" "PortfolioLinkType" NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "memo" VARCHAR(500),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_portfolio_links_app_xor_draft" CHECK (("application_id" IS NULL) <> ("draft_id" IS NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "uk_answers_app_question" ON "application_answers"("application_id", "question_id");

-- CreateIndex (부분 인덱스 — XOR 한쪽만 채워지므로 NULL row 제외, L-013)
CREATE INDEX "idx_resume_files_app" ON "resume_files"("application_id") WHERE "application_id" IS NOT NULL;

-- CreateIndex
CREATE INDEX "idx_resume_files_draft" ON "resume_files"("draft_id") WHERE "draft_id" IS NOT NULL;

-- CreateIndex (CANDID-029 ClamAV 스캔 워커가 PENDING row를 스캔)
CREATE INDEX "idx_resume_files_scan_pending" ON "resume_files"("uploaded_at") WHERE "virus_scan_status" = 'PENDING';

-- CreateIndex
CREATE INDEX "idx_portfolio_app_sort" ON "portfolio_links"("application_id", "sort_order") WHERE "application_id" IS NOT NULL;

-- CreateIndex
CREATE INDEX "idx_portfolio_draft_sort" ON "portfolio_links"("draft_id", "sort_order") WHERE "draft_id" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "application_answers" ADD CONSTRAINT "application_answers_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (L-015 R1: 질문 RESTRICT — 응답 보존, soft-archive로 신규 차단)
ALTER TABLE "application_answers" ADD CONSTRAINT "application_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "job_posting_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_files" ADD CONSTRAINT "resume_files_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (제출 후 application 철회 시 파일 메타 보존 — BR-PII-03)
ALTER TABLE "resume_files" ADD CONSTRAINT "resume_files_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_files" ADD CONSTRAINT "resume_files_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "application_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (부모 application 삭제 시 함께 정리)
ALTER TABLE "portfolio_links" ADD CONSTRAINT "portfolio_links_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_links" ADD CONSTRAINT "portfolio_links_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "application_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
