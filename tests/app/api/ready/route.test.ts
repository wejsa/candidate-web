// CANDID-027 Step 2 — GET /api/ready (readiness) 테스트.
// basePrisma.$queryRaw probe를 mock하여 DB up/down 분기를 검증한다.

import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  basePrisma: { $queryRaw: vi.fn() },
  prisma: {},
}));

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: { $queryRaw: Mock };
};
const { GET } = await import('@/app/api/ready/route');

afterEach(() => {
  vi.clearAllMocks();
});

function request(): NextRequest {
  return new NextRequest('https://candidate.example.com/api/ready', { method: 'GET' });
}

describe('GET /api/ready', () => {
  it('DB probe 성공 시 200 ready + db:up + no-store + ISO timestamp', async () => {
    basePrisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = await GET(request(), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.status).toBe('ready');
    expect(body.checks.db).toBe('up');
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it('DB probe 실패 시 503 unready + db:down + no-store (throw 아닌 정상 응답)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    basePrisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const res = await GET(request(), undefined);
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.status).toBe('unready');
    expect(body.checks.db).toBe('down');
    spy.mockRestore();
  });

  it('probe 실패 시 로깅은 발생하되 error.name만 남기고 DSN/message를 누출하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    basePrisma.$queryRaw.mockRejectedValueOnce(
      new Error('postgres://user:pw@host/db connection failed'),
    );
    await GET(request(), undefined);
    // positive 단언: 로깅이 실제로 1회 발생(무성 실패 차단) + 기대 형식 + error.name 기록.
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).toContain('[ready] database probe failed');
    expect(logged).toContain('Error');
    // negative 단언: DSN/비밀번호/message 전체 누출 차단.
    expect(logged).not.toContain('postgres://');
    expect(logged).not.toContain('pw@');
    expect(logged).not.toContain('connection failed');
    spy.mockRestore();
  });

  it('non-Error reject(객체)도 DSN 누출 없이 UnknownError로 로깅하고 503', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 드라이버가 DSN을 품은 객체를 reject (Error 인스턴스 아님) → error.name else 분기.
    basePrisma.$queryRaw.mockRejectedValueOnce({ dsn: 'postgres://user:pw@host/db' });
    const res = await GET(request(), undefined);
    expect(res.status).toBe(503);
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).toContain('UnknownError');
    expect(logged).not.toContain('postgres://');
    spy.mockRestore();
  });
});
