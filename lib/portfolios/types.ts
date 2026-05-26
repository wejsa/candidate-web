// CANDID-017 Step 1 — Portfolio link 도메인 타입.
// US-APP-004 + BR-LINK-01~04. PortfolioLink 모델은 CANDID-005 Step 2에서 마이그 완료.

import type { PortfolioLinkType } from '@prisma/client';

export type LinkType = PortfolioLinkType;

export const LINK_TYPES = ['GITHUB', 'NOTION', 'BLOG', 'LINKEDIN', 'FIGMA', 'ETC'] as const;

// H004 fix (PR #65 review) — Prisma enum과 LINK_TYPES 상수의 양방향 일치를 컴파일 타임에 강제.
// Prisma에 새 값이 추가되었는데 LINK_TYPES에 누락되거나 반대 케이스도 컴파일 에러로 감지된다.
type AssertLinkTypesExhaustive =
  Exclude<PortfolioLinkType, (typeof LINK_TYPES)[number]> extends never
    ? Exclude<(typeof LINK_TYPES)[number], PortfolioLinkType> extends never
      ? true
      : ['LINK_TYPES has values not in PortfolioLinkType']
    : ['PortfolioLinkType has values not in LINK_TYPES'];
const _assertLinkTypesExhaustive: AssertLinkTypesExhaustive = true;
void _assertLinkTypesExhaustive;

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
