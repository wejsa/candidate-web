import { test, expect } from '@playwright/test';

// CANDID-048 Step 1 — 인프라/페이지 스모크.
// 앱이 정상 부팅되고 핵심 페이지·관측 엔드포인트가 응답하는지 검증한다(완성도 1차 게이트).
// DB(postgres) 기동 전제: /jobs SSR과 /api/ready는 DB에 접근한다(/api/health·/api/metrics는 무관).

test.describe('관측 엔드포인트 (CANDID-027)', () => {
  test('GET /api/health → 200 ok (의존성 무관 liveness)', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });

  test('GET /api/ready → 200/503 + checks.db (readiness)', async ({ request }) => {
    const res = await request.get('/api/ready');
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(['up', 'down']).toContain(body.checks?.db);
    // DB가 떠 있으면 ready여야 한다(E2E 실행 전제).
    if (res.status() === 200) expect(body.status).toBe('ready');
  });

  test('GET /api/metrics → 200 Prometheus exposition', async ({ request }) => {
    // 토큰이 설정된 환경이면 Bearer 주입(운영 fail-closed/토큰 가드와 정합), 미설정이면 무토큰.
    const token = process.env.METRICS_AUTH_TOKEN?.trim();
    const res = await request.get(
      '/api/metrics',
      token ? { headers: { authorization: `Bearer ${token}` } } : {},
    );
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('# TYPE');
    expect(text).toContain('http_request_duration_seconds');
  });
});

test.describe('페이지 렌더', () => {
  test('홈(/) 랜딩 렌더', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'candidate-web' })).toBeVisible();
  });

  test('공고 목록(/jobs) 렌더 — 제목 + 필터 영역', async ({ page }) => {
    await page.goto('/jobs');
    await expect(page.getByRole('heading', { level: 1, name: '채용 공고' })).toBeVisible();
    // 데이터가 없어도 페이지·필터는 렌더된다(빈 목록 허용).
    await expect(page.getByRole('region', { name: '공고 필터' })).toBeVisible();
  });
});
