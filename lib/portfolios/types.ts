// CANDID-017 Step 1 — Portfolio link 도메인 타입.
// US-APP-004 + BR-LINK-01~04. PortfolioLink 모델은 CANDID-005 Step 2에서 마이그 완료.

import type { PortfolioLinkType } from '@prisma/client';

export type LinkType = PortfolioLinkType;

export const LINK_TYPES = ['GITHUB', 'NOTION', 'BLOG', 'LINKEDIN', 'FIGMA', 'ETC'] as const;

/** 1 draft에 최대 5개 (BR-LINK-04). */
export const MAX_PORTFOLIO_LINKS = 5;

export interface PortfolioLinkInput {
  linkType: LinkType;
  url: string;
  memo: string | null;
}

export interface PortfolioLinkOutput extends PortfolioLinkInput {
  id: number;
  sortOrder: number;
}

export interface PortfolioLinksResponse {
  links: PortfolioLinkOutput[];
}
