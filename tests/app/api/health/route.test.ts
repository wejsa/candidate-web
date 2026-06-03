// CANDID-027 Step 2 — GET /api/health (liveness) 테스트.

import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

const { GET } = await import('@/app/api/health/route');

function request(): NextRequest {
  return new NextRequest('https://candidate.example.com/api/health', { method: 'GET' });
}

describe('GET /api/health', () => {
  it('의존성과 무관하게 200 ok를 반환한다', async () => {
    const res = await GET(request(), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('uptime(number)과 ISO timestamp를 포함한다', async () => {
    const res = await GET(request(), undefined);
    const body = await res.json();
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});
