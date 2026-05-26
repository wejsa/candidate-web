// CANDID-017 Step 1 — SSRF 차단 + HTTPS-only URL 검증 (BR-LINK-02, CLAUDE.md "외부 URL fetch").
// CANDID-008 S-MAJOR-1 (PR #57)에서 lib/env.ts에 inline 정의되었던 isPrivateOrMetadataHost를
// 모듈로 승격하여 portfolio link 검증 + 향후 OG fetch P1 (BR-LINK-03)이 공통 사용한다.
// 정책 SSOT: CLAUDE.md "외부 URL fetch" — 내부망 IP(10./172.16-31./192.168./127./169.254.) 거부.

/**
 * IPv4 hostname이 RFC1918 사설/cloud metadata/loopback 영역인지 검사.
 * 도메인(IPv4 형태 아님)은 항상 false 반환 — 호출자가 DNS 해석 후 추가 검증할 책임.
 *
 * - 10.0.0.0/8
 * - 172.16.0.0/12 (172.16~172.31)
 * - 192.168.0.0/16
 * - 169.254.0.0/16 (link-local + AWS/GCP/Azure cloud metadata)
 * - 127.0.0.0/8 (loopback — *호출 측*에서 dev 예외 처리 책임)
 * - 0.0.0.0/8 (current network — invalid)
 */
export function isPrivateOrMetadataHost(hostname: string): boolean {
  const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m === null) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  return false;
}

/**
 * URL이 https:// 스킴인지 검증. 그 외(http, ftp, file, javascript, data 등) 모두 false.
 * BR-LINK-01: portfolio link는 https만 허용.
 */
export function isHttpsUrl(input: string): boolean {
  try {
    return new URL(input).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 외부 fetch에 사용 가능한지 검증한 후 URL 객체 반환.
 * - 파싱 실패 → null
 * - https 아님 → null
 * - hostname이 사설/metadata/loopback IPv4 → null
 * - 그 외 → URL 객체
 *
 * 도메인의 경우 DNS rebinding은 본 함수가 차단하지 못한다 — 호출자가 fetch 시
 * DNS 해석 후 isPrivateOrMetadataHost 재검사 권장 (OG fetch P1에서 처리).
 */
export function safeExternalUrl(input: string): URL | null {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (isPrivateOrMetadataHost(u.hostname)) return null;
  return u;
}
