import 'server-only';
import { type CareerLevel, type EmploymentType, type JobStatus } from '@prisma/client';
import { basePrisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';

// CANDID-053 Step 9 — 운영자 공고 관리 화면용 read 서비스(RSC 직접 호출).
//   공개 목록(lib/jobs/list.ts)은 OPEN만 노출하지만, 운영자는 DRAFT/OPEN/CLOSED 전 상태를 본다.
//   변경(생성/수정/상태전이)은 감사·전이 그래프가 있는 API 라우트(Step 4)를 통한다 — 본 모듈은 read 전용.
//   PII 미접촉(공고/카테고리/지원 건수만) → basePrisma 사용.
//
//   ⚠️ 인가 미수행(계약): 본 함수들은 **비공개 DRAFT 공고를 포함한 전 상태**를 인가 없이 반환한다.
//   반드시 운영자 가드(requireOperatorPage) 통과 뒤에서만 호출할 것 — 가드 없는 진입점이 직접 호출하면
//   미공개 공고/지원 집계가 비운영자에게 노출된다(require-role-page.ts의 "데이터 접근 직전 가드" 원칙과 정합).

const PER_PAGE = 20;
const MAX_PAGE = 10_000;

export interface AdminJobPostingRow {
  id: number;
  title: string;
  status: JobStatus;
  employmentType: EmploymentType;
  careerLevel: CareerLevel;
  categoryName: string;
  opensAt: Date;
  closesAt: Date | null;
  applicationCount: number;
}

export interface AdminJobPostingListResult {
  items: AdminJobPostingRow[];
  pagination: { page: number; perPage: number; total: number; totalPages: number; hasMore: boolean };
}

/** 전 상태 공고 목록(최신순, 페이징). 운영자 전용 — 비공개(DRAFT)·종료(CLOSED) 포함. */
export async function listJobPostingsForAdmin(page = 1): Promise<AdminJobPostingListResult> {
  const safePage = Number.isFinite(page) && page >= 1 ? Math.min(Math.floor(page), MAX_PAGE) : 1;

  const [total, rows] = await Promise.all([
    basePrisma.jobPosting.count(),
    basePrisma.jobPosting.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (safePage - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true,
        title: true,
        status: true,
        employmentType: true,
        careerLevel: true,
        opensAt: true,
        closesAt: true,
        jobCategory: { select: { name: true } },
        _count: { select: { applications: true } },
      },
    }),
  ]);

  const totalPages = total === 0 ? 1 : Math.ceil(total / PER_PAGE);
  return {
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      employmentType: r.employmentType,
      careerLevel: r.careerLevel,
      categoryName: r.jobCategory.name,
      opensAt: r.opensAt,
      closesAt: r.closesAt,
      applicationCount: r._count.applications,
    })),
    pagination: {
      page: safePage,
      perPage: PER_PAGE,
      total,
      totalPages,
      hasMore: safePage < totalPages,
    },
  };
}

export interface JobCategoryOption {
  id: number;
  name: string;
}

/** 공고 폼 직군 선택지 — 활성 카테고리만, 정렬 순. */
export async function listJobCategoryOptions(): Promise<JobCategoryOption[]> {
  const rows = await basePrisma.jobCategory.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true },
  });
  return rows;
}

export interface AdminJobPostingDetail {
  id: number;
  title: string;
  status: JobStatus;
  jobCategoryId: number;
  employmentType: EmploymentType;
  careerLevel: CareerLevel;
  contentHtml: string;
  opensAt: Date;
  closesAt: Date | null;
}

/** 수정 폼 프리필용 단건 조회 — 전 상태 허용(운영자). 미존재 → JOB_NOT_FOUND. */
export async function getJobPostingForEdit(id: number): Promise<AdminJobPostingDetail> {
  const row = await basePrisma.jobPosting.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      status: true,
      jobCategoryId: true,
      employmentType: true,
      careerLevel: true,
      contentHtml: true,
      opensAt: true,
      closesAt: true,
    },
  });
  if (row === null) {
    throw new AppError('JOB_NOT_FOUND');
  }
  return row;
}
