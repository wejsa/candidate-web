-- CANDID-005 Step 3 (마지막): 이력/면접/감사 도메인 — application_status_history + interview_schedules + audit_logs
--
-- PRD §3.3.8~3.3.9 (status_history / interview_schedules) + audit_logs (CANDID-026 본격 도입 전 골격).
-- 신규 테이블만 — destructive 아님 (L-001 N/A).
--
-- audit_logs 특이사항:
--   - FK 미설정 (PHI 분리 원칙) — actorUserId는 plain INTEGER, JOIN은 앱 레이어
--   - BIGSERIAL id (향후 row 폭증 대비)
--   - 파티셔닝 (PARTITION BY RANGE occurred_at)은 CANDID-026 운영 단계 도입

-- CreateTable
CREATE TABLE "application_status_history" (
    "id" SERIAL NOT NULL,
    "application_id" INTEGER NOT NULL,
    "from_stage" "StageType",
    "to_stage" "StageType" NOT NULL,
    "changed_by_user_id" INTEGER,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visible_to_candidate" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "application_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_schedules" (
    "id" SERIAL NOT NULL,
    "application_id" INTEGER NOT NULL,
    "stage" "StageType" NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "location_or_url" VARCHAR(500) NOT NULL,
    "status" "InterviewScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "ics_uid" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable (audit_logs 골격 — CANDID-026 본격 도입 전)
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" INTEGER,
    "event_type" "AuditEventType" NOT NULL,
    "resource_type" VARCHAR(50),
    "resource_id" VARCHAR(64),
    "ip_address" INET,
    "user_agent" VARCHAR(500),
    "metadata_json" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_status_history_app_changed" ON "application_status_history"("application_id", "changed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "interview_schedules_ics_uid_key" ON "interview_schedules"("ics_uid");

-- CreateIndex
CREATE INDEX "idx_interview_app_scheduled" ON "interview_schedules"("application_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "idx_audit_actor_occurred" ON "audit_logs"("actor_user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_resource" ON "audit_logs"("resource_type", "resource_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_event" ON "audit_logs"("event_type", "occurred_at" DESC);

-- AddForeignKey (append-only — RESTRICT)
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (시스템 변경은 NULL → SET NULL)
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_schedules" ADD CONSTRAINT "interview_schedules_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- audit_logs FK 미설정 (PHI 분리)
