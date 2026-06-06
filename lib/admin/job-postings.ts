import 'server-only';
import { AuditEventType, JobStatus, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { recordAuditEvent } from '@/lib/audit/record';
import { sanitizeHtml } from '@/lib/security/sanitize';
import type { JobPostingCreateInput, JobPostingUpdateInput } from '@/lib/admin/job-postings-schema';
// CANDID-053 Step 9 — 전이 그래프 SSOT를 공용 모듈로 분리(클라 StatusControl와 드리프트 구조적 차단).
import { JOB_STATUS_TRANSITIONS as ALLOWED_STATUS_TRANSITIONS } from '@/lib/admin/job-status-transitions';

// CANDID-053 Step 4 — 운영자 공고 관리 CRUD (RBAC, A안).
//
// 보안/도메인:
//   - contentHtml은 저장 시점에 sanitizeHtml('job-posting')로 정화(BR: 저장+출력 이중 방어).
//   - jobCategoryId FK 선검증(미존재 → SYS_VALIDATION_FAILED, RESTRICT 위반 500 방지).
//   - 상태 전이는 명시 그래프(JOB_STATUS_TRANSITIONS SSOT)로 강제 — 임의 전이 차단.
//   - 변경 + 감사(JOB_POSTING_CREATED/UPDATED/STATUS_CHANGED)는 단일 트랜잭션(BR-TX-01).

/** opensAt < closesAt 불변식 — 즉시-마감(유령) 공고 차단. closesAt null(상시)은 통과. */
function assertOpenCloseOrder(opensAt: Date, closesAt: Date | null): void {
  if (closesAt !== null && closesAt.getTime() <= opensAt.getTime()) {
    throw new AppError('SYS_VALIDATION_FAILED', {
      message: '마감일시는 시작일시보다 이후여야 합니다.',
      details: [{ field: 'closesAt', reason: 'closesAt must be after opensAt' }],
    });
  }
}

export interface JobPostingSummary {
  id: number;
  title: string;
  status: JobStatus;
}

async function assertCategoryExists(client: typeof prisma, jobCategoryId: number): Promise<void> {
  const category = await client.jobCategory.findUnique({
    where: { id: jobCategoryId },
    select: { id: true },
  });
  if (category === null) {
    throw new AppError('SYS_VALIDATION_FAILED', {
      message: '존재하지 않는 직군(jobCategoryId)입니다.',
      details: [{ field: 'jobCategoryId', reason: 'not found' }],
    });
  }
}

export interface CreateJobPostingArgs {
  actorUserId: number;
  input: JobPostingCreateInput;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** 공고 생성 — 항상 DRAFT로 시작(노출은 별도 OPEN 전이). */
export async function createJobPosting(args: CreateJobPostingArgs): Promise<JobPostingSummary> {
  const { actorUserId, input } = args;
  await assertCategoryExists(prisma, input.jobCategoryId);

  const opensAt = new Date(input.opensAt);
  const closesAt = typeof input.closesAt === 'string' ? new Date(input.closesAt) : null;
  assertOpenCloseOrder(opensAt, closesAt);

  const contentHtml = sanitizeHtml(input.contentHtml, 'job-posting');

  return prisma.$transaction(async (tx) => {
    const created = await tx.jobPosting.create({
      data: {
        title: input.title,
        jobCategoryId: input.jobCategoryId,
        employmentType: input.employmentType,
        careerLevel: input.careerLevel,
        contentHtml,
        opensAt,
        closesAt,
        status: JobStatus.DRAFT,
      },
      select: { id: true, title: true, status: true },
    });
    await recordAuditEvent(
      {
        eventType: AuditEventType.JOB_POSTING_CREATED,
        actorUserId,
        resourceType: 'job_posting',
        resourceId: String(created.id),
        ipAddress: args.ipAddress ?? null,
        userAgent: args.userAgent ?? null,
        metadata: { status: created.status },
      },
      { tx },
    );
    return created;
  });
}

export interface UpdateJobPostingArgs {
  actorUserId: number;
  jobPostingId: number;
  patch: JobPostingUpdateInput;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** 공고 수정 — 내용 수정 / 상태 전이(전이 그래프 강제). */
export async function updateJobPosting(args: UpdateJobPostingArgs): Promise<JobPostingSummary> {
  const { actorUserId, jobPostingId, patch } = args;

  if (patch.jobCategoryId !== undefined) {
    await assertCategoryExists(prisma, patch.jobCategoryId);
  }

  return prisma.$transaction(async (tx) => {
    // 행 잠금 후 현재 상태/일정 조회 — 동시 PATCH read-then-update race 직렬화(Step 3 선례 정합).
    // eslint-disable-next-line no-restricted-syntax -- FOR UPDATE 잠금 전용, PII 컬럼 미선택 (db-designer CRITICAL 가드)
    const rows = await tx.$queryRaw<{ status: JobStatus; opens_at: Date; closes_at: Date | null }[]>`
      SELECT status, opens_at, closes_at FROM job_postings WHERE id = ${jobPostingId} FOR UPDATE
    `;
    const existing = rows[0];
    if (existing === undefined) {
      throw new AppError('JOB_NOT_FOUND');
    }

    const data: Prisma.JobPostingUpdateInput = {};
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.employmentType !== undefined) data.employmentType = patch.employmentType;
    if (patch.careerLevel !== undefined) data.careerLevel = patch.careerLevel;
    if (patch.jobCategoryId !== undefined) {
      data.jobCategory = { connect: { id: patch.jobCategoryId } };
    }
    if (patch.contentHtml !== undefined) {
      data.contentHtml = sanitizeHtml(patch.contentHtml, 'job-posting');
    }
    const effectiveOpensAt = patch.opensAt !== undefined ? new Date(patch.opensAt) : existing.opens_at;
    let effectiveClosesAt = existing.closes_at;
    if (patch.opensAt !== undefined) data.opensAt = effectiveOpensAt;
    if (patch.closesAt !== undefined) {
      // 외부 if로 undefined는 이미 제외 — null(상시 모집) 또는 string.
      effectiveClosesAt = patch.closesAt === null ? null : new Date(patch.closesAt);
      data.closesAt = effectiveClosesAt;
    }
    // 병합된 일정의 불변식 검증(즉시-마감 공고 차단).
    if (patch.opensAt !== undefined || patch.closesAt !== undefined) {
      assertOpenCloseOrder(effectiveOpensAt, effectiveClosesAt);
    }

    // 상태 전이 — 전이 그래프 강제(잠금 후 읽은 현재 상태 기준).
    let statusChanged = false;
    if (patch.status !== undefined && patch.status !== existing.status) {
      const allowed = ALLOWED_STATUS_TRANSITIONS[existing.status];
      if (!allowed.includes(patch.status)) {
        throw new AppError('JOB_INVALID_STATUS_TRANSITION', {
          message: `허용되지 않는 상태 전이입니다: ${existing.status} → ${patch.status}`,
          details: [{ field: 'status', reason: `from ${existing.status} to ${patch.status}` }],
        });
      }
      data.status = patch.status;
      statusChanged = true;
    }

    const updated = await tx.jobPosting.update({
      where: { id: jobPostingId },
      data,
      select: { id: true, title: true, status: true },
    });

    await recordAuditEvent(
      {
        eventType: statusChanged
          ? AuditEventType.JOB_POSTING_STATUS_CHANGED
          : AuditEventType.JOB_POSTING_UPDATED,
        actorUserId,
        resourceType: 'job_posting',
        resourceId: String(jobPostingId),
        ipAddress: args.ipAddress ?? null,
        userAgent: args.userAgent ?? null,
        metadata: statusChanged
          ? { from: existing.status, to: updated.status }
          : { status: updated.status },
      },
      { tx },
    );

    return updated;
  });
}
