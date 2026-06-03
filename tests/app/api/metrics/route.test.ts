// CANDID-027 Step 1 — GET /api/metrics route 테스트.
// 토큰 가드(설정/미설정 × 일치/불일치) + 정상 스크랩 응답을 검증한다 (L-034: 가드 자체 테스트 동반).

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetMetricsRegistryForTesting, recordBusinessEvent } from '@/lib/observability/metrics';

const { GET } = await import('@/app/api/metrics/route');

beforeEach(() => {
  __resetMetricsRegistryForTesting();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetMetricsRegistryForTesting();
});

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://candidate.example.com/api/metrics', {
    method: 'GET',
    headers,
  });
}

describe('GET /api/metrics — 인증', () => {
  it('METRICS_AUTH_TOKEN 미설정 시 인증 없이 200을 반환한다', async () => {
    vi.stubEnv('METRICS_AUTH_TOKEN', '');
    const res = await GET(request(), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('토큰 설정 + Authorization 헤더 부재 시 403', async () => {
    vi.stubEnv('METRICS_AUTH_TOKEN', 'secret-scrape-token');
    const res = await GET(request(), undefined);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('AUTH_FORBIDDEN');
  });

  it('토큰 설정 + 길이 다른 잘못된 토큰 시 403 (safeEqual 길이 가드 분기)', async () => {
    vi.stubEnv('METRICS_AUTH_TOKEN', 'secret-scrape-token'); // 19자
    const res = await GET(request({ authorization: 'Bearer short' }), undefined);
    expect(res.status).toBe(403);
  });

  it('토큰 설정 + 동일 길이 다른 내용 토큰 시 403 (timingSafeEqual 본문 경로)', async () => {
    vi.stubEnv('METRICS_AUTH_TOKEN', 'secret-scrape-token'); // 19자
    // 기대값과 같은 19자라 길이 가드를 통과 → timingSafeEqual 실제 호출부 검증.
    const res = await GET(request({ authorization: 'Bearer secret-scrape-toke!' }), undefined);
    expect(res.status).toBe(403);
  });

  it.each([
    ['스킴 불일치(Basic)', 'Basic secret-scrape-token'],
    ['Bearer 접두어 없는 raw 토큰', 'secret-scrape-token'],
    ['Bearer 뒤 공백만', 'Bearer    '],
  ])('토큰 설정 + %s → 403', async (_label, header) => {
    vi.stubEnv('METRICS_AUTH_TOKEN', 'secret-scrape-token');
    const res = await GET(request({ authorization: header }), undefined);
    expect(res.status).toBe(403);
  });

  it('토큰 설정 + 올바른 Bearer 토큰 시 200', async () => {
    vi.stubEnv('METRICS_AUTH_TOKEN', 'secret-scrape-token');
    const res = await GET(request({ authorization: 'Bearer secret-scrape-token' }), undefined);
    expect(res.status).toBe(200);
  });

  it('소문자 bearer 스킴 + 올바른 토큰 시 200 (정규식 i 플래그)', async () => {
    vi.stubEnv('METRICS_AUTH_TOKEN', 'secret-scrape-token');
    const res = await GET(request({ authorization: 'bearer secret-scrape-token' }), undefined);
    expect(res.status).toBe(200);
  });

  it('토큰 뒤 trailing 공백이 있어도 trim 후 일치 시 200', async () => {
    vi.stubEnv('METRICS_AUTH_TOKEN', 'secret-scrape-token');
    const res = await GET(request({ authorization: 'Bearer secret-scrape-token   ' }), undefined);
    expect(res.status).toBe(200);
  });

  it('METRICS_AUTH_TOKEN 공백만 설정 시 미설정과 동일 취급 — 비운영은 open(200)', async () => {
    vi.stubEnv('METRICS_AUTH_TOKEN', '   '); // trim 후 빈값 → open
    const res = await GET(request(), undefined);
    expect(res.status).toBe(200);
  });

  it('운영(production) + 토큰 미설정 시 fail-closed 403', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('METRICS_AUTH_TOKEN', '');
    const res = await GET(request(), undefined);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('AUTH_FORBIDDEN');
  });

  it('운영(production) + 올바른 토큰 시 200', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('METRICS_AUTH_TOKEN', 'secret-scrape-token');
    const res = await GET(request({ authorization: 'Bearer secret-scrape-token' }), undefined);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/metrics — 본문', () => {
  it('기록된 비즈니스 카운터를 exposition 텍스트로 노출한다', async () => {
    vi.stubEnv('METRICS_AUTH_TOKEN', '');
    recordBusinessEvent('signup', 'success');
    const res = await GET(request(), undefined);
    const text = await res.text();
    expect(text).toContain('candidate_business_event_total{event="signup",result="success"} 1');
    expect(text).toContain('process_cpu_user_seconds_total');
  });
});
