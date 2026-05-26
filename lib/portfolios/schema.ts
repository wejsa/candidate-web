// CANDID-017 Step 1 — Portfolio link zod 스키마.
// BR-LINK-01 (https only), BR-LINK-02 (ssrf-guard), BR-LINK-04 (max 5), 도메인 화이트리스트.
// L-006 3-layer defense: 정적 enum + zod 직렬화 + service 런타임.

import { z } from 'zod';
import { safeExternalUrl } from '@/lib/security/ssrf-guard';
import { isAllowedHost } from '@/lib/portfolios/allowed-domains';
import { LINK_TYPES, MAX_PORTFOLIO_LINKS } from '@/lib/portfolios/types';

const LinkTypeSchema = z.enum(LINK_TYPES);

/**
 * 단일 portfolio link 입력 검증.
 * - linkType: enum
 * - url: https + ssrf-guard 통과 + linkType별 도메인 화이트리스트
 * - memo: 선택, ≤500자, 공백만이면 null로 정규화
 */
export const PortfolioLinkInputSchema = z
  .object({
    linkType: LinkTypeSchema,
    url: z.string().trim().min(1).max(1000),
    memo: z
      .union([z.string().max(500), z.null()])
      .optional()
      .transform((v) => {
        if (v === undefined || v === null) return null;
        const trimmed = v.trim();
        return trimmed === '' ? null : trimmed;
      }),
  })
  .superRefine((data, ctx) => {
    const u = safeExternalUrl(data.url);
    if (u === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message:
          'URL은 https://로 시작해야 하며 사설/내부망 IP는 허용되지 않습니다 (BR-LINK-01/02).',
      });
      return;
    }
    if (!isAllowedHost(data.linkType, u.hostname)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: `${data.linkType} 링크는 허용된 도메인만 입력할 수 있습니다.`,
      });
    }
  });

/**
 * PUT 요청 body. 최대 5개 (BR-LINK-04).
 * - 빈 배열 허용 (사용자가 모든 링크 삭제하는 경우)
 */
export const PortfolioLinksRequestSchema = z.object({
  links: z
    .array(PortfolioLinkInputSchema)
    .max(MAX_PORTFOLIO_LINKS, `포트폴리오 링크는 최대 ${MAX_PORTFOLIO_LINKS}개까지 입력 가능합니다.`),
});

export type PortfolioLinksRequest = z.infer<typeof PortfolioLinksRequestSchema>;

/** URL path param 검증 — jobPostingId는 양의 정수. */
export const JobPostingIdParamSchema = z.object({
  jobPostingId: z.coerce.number().int().positive(),
});
