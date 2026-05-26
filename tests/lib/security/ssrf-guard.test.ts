// CANDID-017 Step 1 — ssrf-guard 단위 테스트.

import { describe, expect, it } from 'vitest';
import {
  isHttpsUrl,
  isPrivateOrMetadataHost,
  safeExternalUrl,
} from '@/lib/security/ssrf-guard';

describe('isPrivateOrMetadataHost', () => {
  it.each([
    ['10.0.0.1', true],
    ['10.255.255.255', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.15.0.1', false],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['192.168.255.255', true],
    ['192.167.1.1', false],
    ['169.254.169.254', true],
    ['127.0.0.1', true],
    ['127.255.255.255', true],
    ['0.0.0.0', true],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
  ])('hostname %s → %s', (host, expected) => {
    expect(isPrivateOrMetadataHost(host)).toBe(expected);
  });

  it('도메인(IPv4 형태 아님)은 항상 false (호출자가 DNS 해석 책임)', () => {
    expect(isPrivateOrMetadataHost('github.com')).toBe(false);
    expect(isPrivateOrMetadataHost('localhost')).toBe(false);
    expect(isPrivateOrMetadataHost('evil.example.com')).toBe(false);
  });

  it('IPv6는 본 함수가 차단하지 않음 (별도 정책 필요)', () => {
    expect(isPrivateOrMetadataHost('::1')).toBe(false);
    expect(isPrivateOrMetadataHost('fe80::1')).toBe(false);
  });
});

describe('isHttpsUrl', () => {
  it('https URL은 true', () => {
    expect(isHttpsUrl('https://github.com/owner/repo')).toBe(true);
  });

  it.each([
    ['http://example.com', false],
    ['ftp://example.com', false],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
    ['data:text/html,xxx', false],
    ['not-a-url', false],
    ['', false],
  ])('non-https %s → false', (input, expected) => {
    expect(isHttpsUrl(input)).toBe(expected);
  });
});

describe('safeExternalUrl', () => {
  it('정상 https + public IP → URL 객체', () => {
    const u = safeExternalUrl('https://github.com/owner/repo');
    expect(u).not.toBeNull();
    expect(u?.hostname).toBe('github.com');
  });

  it('http는 차단', () => {
    expect(safeExternalUrl('http://github.com')).toBeNull();
  });

  it('private IP hostname은 차단', () => {
    expect(safeExternalUrl('https://10.0.0.1/path')).toBeNull();
    expect(safeExternalUrl('https://192.168.1.1')).toBeNull();
    expect(safeExternalUrl('https://169.254.169.254/latest/meta-data')).toBeNull();
    expect(safeExternalUrl('https://127.0.0.1:8080')).toBeNull();
  });

  it('파싱 실패는 null', () => {
    expect(safeExternalUrl('not a url')).toBeNull();
    expect(safeExternalUrl('')).toBeNull();
  });

  it('JS scheme 등 https 외는 차단 (XSS payload URL 방어)', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('data:text/html,<script>')).toBeNull();
  });

  it('도메인은 통과 (호출 측이 DNS 해석 후 재검사 — OG fetch P1 책임)', () => {
    expect(safeExternalUrl('https://notion.so/page')).not.toBeNull();
  });

  // H006 fix (PR #65 review) — user-info / non-standard port 거부.
  it('user-info(`user@host`) 포함 URL은 차단 (피싱 회피)', () => {
    expect(safeExternalUrl('https://attacker.com@github.com/repo')).toBeNull();
    expect(safeExternalUrl('https://user:pass@github.com/repo')).toBeNull();
  });

  it('non-standard port(443 아님)는 차단, 명시적 443은 허용', () => {
    expect(safeExternalUrl('https://github.com:8443/repo')).toBeNull();
    expect(safeExternalUrl('https://github.com:80/repo')).toBeNull();
    expect(safeExternalUrl('https://github.com:443/repo')).not.toBeNull();
  });
});
