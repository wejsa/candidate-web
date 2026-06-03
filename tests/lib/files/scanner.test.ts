import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetScannerForTesting, getScanner } from '@/lib/files/scanner';
import { __resetCachedEnvForTesting } from '@/lib/env';

// CANDID-029 Step 3 — 스캐너 스텁 단위 테스트.

beforeEach(() => {
  __resetScannerForTesting();
  __resetCachedEnvForTesting();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  __resetScannerForTesting();
  __resetCachedEnvForTesting();
});

describe('getScanner', () => {
  it('기본(CLAMAV_ENABLED 미설정) — 스텁이 항상 SKIPPED 반환', async () => {
    const verdict = await getScanner().scan({ storedPath: 'resumes/2026/05/x.pdf' });
    expect(verdict).toBe('SKIPPED');
  });

  it('동일 인스턴스를 캐시한다(싱글톤)', () => {
    expect(getScanner()).toBe(getScanner());
  });

  it('CLAMAV_ENABLED=true여도 미구현 경고 후 SKIPPED 폴백', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('CLAMAV_ENABLED', 'true');
    __resetCachedEnvForTesting();
    __resetScannerForTesting();

    const verdict = await getScanner().scan({ storedPath: 'resumes/2026/05/x.pdf' });

    expect(verdict).toBe('SKIPPED');
    expect(warn).toHaveBeenCalled();
  });
});
