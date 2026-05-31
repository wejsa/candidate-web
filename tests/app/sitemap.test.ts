// CANDID-025 Step 2 — app/sitemap.ts 단위 테스트.
// listIndexableJobs를 mock하고 route default export를 직접 호출해 매핑 로직을 검증한다
// (route default-export 직접 테스트 패턴 — tests/app/api/v1/jobs/route.test.ts).
// baseUrl은 모듈 스코프 상수 → env 케이스마다 resetModules + dynamic import.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/jobs/sitemap-data', () => ({
  listIndexableJobs: vi.fn(),
}));

const { listIndexableJobs } = (await import('@/lib/jobs/sitemap-data')) as unknown as {
  listIndexableJobs: Mock;
};

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://candidate.example.com');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('sitemap', () => {
  it('emits static routes (/, /jobs) followed by a /jobs/{id} entry per job with lastModified', async () => {
    const updatedAt = new Date('2026-05-02T00:00:00.000Z');
    listIndexableJobs.mockResolvedValue([{ id: 7, updatedAt }]);
    const { default: sitemap } = await import('@/app/sitemap');

    const result = await sitemap();

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ url: 'https://candidate.example.com/', priority: 1 });
    expect(result[1]).toMatchObject({ url: 'https://candidate.example.com/jobs', priority: 0.9 });
    const jobEntry = result.find((r) => r.url.endsWith('/jobs/7'));
    expect(jobEntry).toMatchObject({
      url: 'https://candidate.example.com/jobs/7',
      lastModified: updatedAt,
      priority: 0.8,
    });
  });

  it('emits only the two static routes when there are no jobs', async () => {
    listIndexableJobs.mockResolvedValue([]);
    const { default: sitemap } = await import('@/app/sitemap');

    const result = await sitemap();

    expect(result).toHaveLength(2);
    expect(result.every((r) => !r.url.includes('/jobs/'))).toBe(true);
  });
});
