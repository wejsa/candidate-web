// CANDID-017 Step 1 — Portfolio link 서비스 (US-APP-004).
// Draft 기반 CRUD. application_id로의 이전은 CANDID-018 트랜잭션 책임.
// L-019 in-task self-correction (PR #65 fix loop 1):
//   - C001 fix: replaceForDraft에 SELECT FOR UPDATE row-level lock
//     → 동시 PUT race로 인한 중복 row + BR-LINK-04 위반 차단.
//     L-024(drafts/service.ts) updateMany 낙관적 락은 portfolio_links에 version 컬럼/
//     (draft_id) UNIQUE가 없어 직접 적용 불가 — raw lock 선택.
//   - H001 fix: MAX_PORTFOLIO_LINKS 상수 사용 (L-006 3-layer 동질성 보장)
//   - H002 fix: assertDraftOwned 헬퍼가 tx client도 받도록 일반화 (DRY)
//   - N001/N002 fix (재리뷰): raw lock의 ownership 재검증 중복 제거 + 주석 정정.

import 'server-only';
import { Prisma } from '@prisma/client';
import { basePrisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import {
  MAX_PORTFOLIO_LINKS,
  type PortfolioLinkInput,
  type PortfolioLinkOutput,
} from '@/lib/portfolios/types';

interface OwnedDraftKey {
  userId: number;
  jobPostingId: number;
}

type PrismaLike = typeof basePrisma | Prisma.TransactionClient;

/**
 * Draft 존재 + ownership 검사 → draft.id 반환.
 * - 미존재 또는 다른 사용자의 draft → APP_DRAFT_NOT_FOUND (정보 누출 차단)
 * - 트랜잭션 컨텍스트에서 호출 시 tx 클라이언트를 넘기면 같은 격리 안에서 검증
 */
async function assertDraftOwned(
  { userId, jobPostingId }: OwnedDraftKey,
  client: PrismaLike = basePrisma,
): Promise<number> {
  const draft = await client.applicationDraft.findUnique({
    where: { userId_jobPostingId: { userId, jobPostingId } },
    select: { id: true },
  });
  if (draft === null) throw new AppError('APP_DRAFT_NOT_FOUND');
  return draft.id;
}

/**
 * Draft에 저장된 portfolio link 목록을 sortOrder 오름차순으로 반환.
 * Draft 미존재 또는 권한 없음 → APP_DRAFT_NOT_FOUND.
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
 *
 * C001 fix (PR #65 review): SELECT ... FOR UPDATE로 application_drafts row를 잠가
 * 동시 PUT 인터리브를 직렬화한다.
 *   - delete-then-insert + ReadCommitted 격리 + (draftId) UNIQUE 부재 조합은
 *     양쪽 트랜잭션이 phantom write를 commit하여 중복 row + sortOrder 충돌 발생
 *   - SELECT FOR UPDATE는 두 번째 트랜잭션을 첫 트랜잭션 commit 후로 직렬화 (BR-LINK-04 보장)
 *   - L-024(drafts/service.ts) updateMany 낙관적 락은 portfolio_links에 version 컬럼/
 *     (draft_id) UNIQUE 부재로 직접 적용 불가 — raw lock 선택.
 *
 * - 빈 배열 입력은 모든 링크 삭제로 처리됨
 * - schema에서 max 5 검증되었지만 service 런타임에서도 방어 (L-006)
 */
export async function replaceForDraft({
  userId,
  jobPostingId,
  links,
}: ReplaceInput): Promise<PortfolioLinkOutput[]> {
  if (links.length > MAX_PORTFOLIO_LINKS) {
    throw new AppError('SYS_VALIDATION_FAILED');
  }
  return basePrisma.$transaction(
    async (tx) => {
      // C001 fix: row-level lock으로 동시 PUT 직렬화. raw SELECT가 (user_id, job_posting_id)
      // 복합 조건으로 ownership 검증 + lock을 동시에 수행하므로 별도 prisma 재조회 불필요(N001 fix).
      // eslint-disable-next-line no-restricted-syntax -- CANDID-017: application_drafts.id만 select (PII 컬럼 미포함). ownership 직렬화 목적의 row-level lock.
      const locked = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM application_drafts
        WHERE user_id = ${userId} AND job_posting_id = ${jobPostingId}
        FOR UPDATE
      `;
      if (locked.length === 0 || locked[0] === undefined) {
        throw new AppError('APP_DRAFT_NOT_FOUND');
      }
      const draftId = locked[0].id;
      await tx.portfolioLink.deleteMany({ where: { draftId } });
      if (links.length === 0) return [];
      await tx.portfolioLink.createMany({
        data: links.map((link, index) => ({
          draftId,
          applicationId: null,
          linkType: link.linkType,
          url: link.url,
          memo: link.memo,
          sortOrder: index,
        })),
      });
      const rows = await tx.portfolioLink.findMany({
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
      })) satisfies PortfolioLinkOutput[];
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
