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
  it('DB probe 성공 시 200 ready + db:up', async () => {
    basePrisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = await GET(request(), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
    expect(body.checks.db).toBe('up');
  });

  it('DB probe 실패 시 503 unready + db:down (throw 아닌 정상 응답)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    basePrisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const res = await GET(request(), undefined);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('unready');
    expect(body.checks.db).toBe('down');
    spy.mockRestore();
  });

  it('DB probe 실패 로그에 raw error 객체(DSN 누출 위험)를 남기지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    basePrisma.$queryRaw.mockRejectedValueOnce(
      new Error('postgres://user:pw@host/db connection failed'),
    );
    await GET(request(), undefined);
    // 로그 인자에 DSN/비밀번호 문자열이 포함되지 않아야 한다 (error.name만 기록).
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('postgres://');
    expect(logged).not.toContain('pw@');
    spy.mockRestore();
  });
});
