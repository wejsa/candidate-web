// CANDID-017 Step 1 — Portfolio linkType → 허용 도메인 매핑 SSOT.
// 본 표가 유일한 진실 소스 — schema/service는 본 표를 참조한다 (역참조 금지).
// 신규 linkType 추가 시: types.ts의 LINK_TYPES + 본 매핑 양쪽 갱신 + 컴파일 타임 exhaustiveness 강제.

import type { LinkType } from '@/lib/portfolios/types';

/**
 * linkType별 호스트 화이트리스트 (regex). null이면 자유 도메인(https + ssrf-guard만).
 *
 * - GITHUB: github.com + gist (개인/저장소/조직)
 * - NOTION: notion.so / www.notion.so / *.notion.site (workspace subdomain)
 * - LINKEDIN: ([cc].)linkedin.com (지역 서브도메인 허용)
 * - FIGMA: ([cc].)figma.com
 * - BLOG/ETC: null (자유 도메인 — https + private IP 차단으로만 방어)
 */
export const ALLOWED_HOSTS: Record<LinkType, readonly RegExp[] | null> = {
  GITHUB: [/^github\.com$/, /^gist\.github\.com$/],
  NOTION: [/^notion\.so$/, /^www\.notion\.so$/, /^[a-z0-9-]+\.notion\.site$/],
  LINKEDIN: [/^([a-z]{2}\.)?linkedin\.com$/],
  FIGMA: [/^([a-z]{2}\.)?figma\.com$/],
  BLOG: null,
  ETC: null,
};

/**
 * url의 hostname이 linkType의 화이트리스트에 매칭되는지 검사.
 * 화이트리스트가 null이면 항상 true 반환 (도메인 자유).
 * https + private IP 검증은 호출 측(schema.ts)의 isHttpsUrl/safeExternalUrl 책임.
 */
export function isAllowedHost(linkType: LinkType, hostname: string): boolean {
  const patterns = ALLOWED_HOSTS[linkType];
  if (patterns === null) return true;
  const lowered = hostname.toLowerCase();
  return patterns.some((re) => re.test(lowered));
}
