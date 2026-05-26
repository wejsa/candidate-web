// CANDID-017 Step 1 — Portfolio link 서비스 (US-APP-004).
// Draft 기반 CRUD. application_id로의 이전은 CANDID-018 트랜잭션 책임.
// L-019 in-task: assertDraftOwned 헬퍼로 권한+존재 검사 단일화 (정보 누출 차단 — 두 케이스 동일 코드).

import 'server-only';
import { Prisma } from '@prisma/client';
import { basePrisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import type { PortfolioLinkInput, PortfolioLinkOutput } from '@/lib/portfolios/types';

interface OwnedDraftKey {
  userId: number;
  jobPostingId: number;
}

/**
 * Draft 존재 + ownership 검사 → draft.id 반환.
 * 미존재 또는 다른 사용자의 draft → APP_DRAFT_NOT_FOUND (정보 누출 차단).
 */
async function assertDraftOwned({ userId, jobPostingId }: OwnedDraftKey): Promise<number> {
  const draft = await basePrisma.applicationDraft.findUnique({
    where: { userId_jobPostingId: { userId, jobPostingId } },
    select: { id: true },
  });
  if (draft === null) throw new AppError('APP_DRAFT_NOT_FOUND');
  return draft.id;
}

/**
 * Draft에 저장된 portfolio link 목록을 sortOrder 오름차순으로 반환.
 * Draft 미존재 → APP_DRAFT_NOT_FOUND.
 */
export async function listByDraft({
  userId,
  jobPostingId,
}: OwnedDraftKey): Promise<PortfolioLinkOutput[]> {
  const draftId = await assertDraftOwned({ userId, jobPostingId });
  const rows = await basePrisma.portfolioLink.findMany({
    where: { draftId },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      linkType: true,
      url: true,
      memo: true,
      sortOrder: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    linkType: r.linkType,
    url: r.url,
    memo: r.memo,
    sortOrder: r.sortOrder,
  }));
}

interface ReplaceInput extends OwnedDraftKey {
  links: PortfolioLinkInput[];
}

/**
 * Draft의 portfolio link 전체 교체 (replace strategy).
 * - 트랜잭션: 1) ownership 검사 2) delete all 3) insert N (sort_order = 배열 순서)
 * - 빈 배열 입력은 모든 링크 삭제로 처리됨.
 * - schema에서 max 5 검증되었지만 service에서 한번 더 방어 (L-006 런타임 layer).
 */
export async function replaceForDraft({
  userId,
  jobPostingId,
  links,
}: ReplaceInput): Promise<PortfolioLinkOutput[]> {
  if (links.length > 5) {
    throw new AppError('SYS_VALIDATION_FAILED');
  }
  return basePrisma.$transaction(async (tx) => {
    const draft = await tx.applicationDraft.findUnique({
      where: { userId_jobPostingId: { userId, jobPostingId } },
      select: { id: true },
    });
    if (draft === null) throw new AppError('APP_DRAFT_NOT_FOUND');
    await tx.portfolioLink.deleteMany({ where: { draftId: draft.id } });
    if (links.length === 0) return [];
    await tx.portfolioLink.createMany({
      data: links.map((link, index) => ({
        draftId: draft.id,
        applicationId: null,
        linkType: link.linkType,
        url: link.url,
        memo: link.memo,
        sortOrder: index,
      })),
    });
    const rows = await tx.portfolioLink.findMany({
      where: { draftId: draft.id },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        linkType: true,
        url: true,
        memo: true,
        sortOrder: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      linkType: r.linkType,
      url: r.url,
      memo: r.memo,
      sortOrder: r.sortOrder,
    })) satisfies PortfolioLinkOutput[];
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
