# CANDID-051 — 공고 상세/지원 페이지 `notFound()` soft-404 (HTTP 200) · SEO

- **유형**: bug (조사 결과: 프레임워크 한계 → 미티게이션으로 종결)
- **Phase**: 3 · **우선순위**: medium
- **관련 파일**: `app/jobs/[id]/page.tsx`, `app/jobs/[id]/apply/page.tsx`, `app/jobs/[id]/not-found.tsx`, `app/jobs/[id]/apply/not-found.tsx`, `middleware.ts`
- **회귀 가드**: `tests/app/jobs/[id]/not-found-status.test.tsx`, `e2e/prod/soft-404.spec.ts`, `playwright.prod.config.ts`

---

## 1. 관측

전체 기능 Playwright QA(ad-hoc, 미커밋) 중 발견: 미존재/비숫자 공고에 대해 `/jobs/[id]`,
`/jobs/[id]/apply`의 RSC가 `notFound()`를 호출하면 not-found 콘텐츠는 정상 렌더되지만 **HTTP 상태가
404가 아닌 200(soft-404)**. 대조군은 정상(`/totally-bogus-route` → 404, API `/api/v1/job-postings/{id}` → 404).

SEO NFR(공고 페이지 검색 색인) 관점에서 soft-404는 죽은 URL의 색인을 유발할 수 있다.

## 2. Production 검증 (2026-06-04, `next start` v14.2.35, `NODE_ENV=production`)

원 QA는 `pnpm dev`(Playwright webServer) 대상이었고 "dev 전용 아티팩트(prod=404)" 가설이 있었다.
**prod 빌드 실측으로 가설을 반증**했다:

| 경로 | prod status | 비고 |
|------|:----:|------|
| `/jobs/abc` (비숫자 id → `notFound()`) | **200** | `<head>`에 robots noindex 존재, 본문은 not-found UI |
| `/jobs/0` (양의 정수 위반 → `notFound()`) | **200** | |
| `/totally-bogus-route` (미정의 라우트) | **404** | root not-found 정상 |
| `/api/v1/job-postings/999999` | **404** | `JOB_NOT_FOUND` |

→ **dev 전용이 아니라 production 실재 현상.**

## 3. 근본 원인 조사 (격리 실험)

`/jobs/{잘못된id}`(matched route, `notFound()`)는 200, `/totally-bogus-route`(unmatched)는 404 —
**유일한 차이는 "매칭된 라우트의 RSC가 런타임에 `notFound()`를 호출"**이라는 점. 후보 레버를 prod 빌드로 하나씩 제거:

| 가설 (제거한 것) | 결과 |
|------|:----:|
| `export const dynamic = 'force-dynamic'` 제거 | 여전히 200 |
| `app/jobs/[id]/loading.tsx`(Suspense 경계) 제거 | 여전히 200 |
| middleware `NextResponse.next({request})` → 페이지에 plain `next()` 스코프 | 여전히 200 |
| **`middleware.ts` 완전 제거** | 여전히 200 |

**결론**: soft-404는 force-dynamic·streaming·middleware 어느 것의 산물도 아닌 **Next.js 14.2 코어 동작**이다.
동적 렌더(SSR) 매칭 라우트에서 런타임 `notFound()`는 HTTP 200을 반환하며, 404는 미정의(unmatched) 라우트
또는 정적 생성 경로에서만 신뢰 가능하다. **앱 코드로 404를 강제할 수 있는 레버가 없다.**

> 미들웨어 우회(폴백)도 한계가 있다: 형식이 잘못된 id(`/jobs/abc`)는 Edge에서 404로 만들 수 있으나,
> **실제 SEO 위험인 "삭제된 유효 공고"(`/jobs/999999`)**는 Edge 런타임에서 DB 존재 확인이 불가해 처리할 수 없다.

## 4. 결정 — 미티게이션 강화 + 문서화

HTTP 404를 코드로 달성할 수 없으므로, **죽은 URL의 검색 색인을 막는 실질 목표**를 `robots: noindex`로 보장한다.

1. **상세 페이지** (`page.tsx`): `generateMetadata`가 not-found 케이스(비숫자 id / `JOB_NOT_FOUND`)에
   `robots: { index: false, follow: false }`를 반환한다(기존 동작 유지·문서화). 이 분기가 **유일한 SEO 방어선**.
2. **지원 페이지** (`apply/page.tsx`): 정적 `export const metadata = { robots: noindex }` 추가 —
   인증 게이트 뒤 개인화 폼이라 *항상* 비색인. soft-404 경로 포함 모든 진입에서 색인 차단.
3. **한계 문서화**: 두 페이지 코드 주석 + 본 문서 + README "E2E 메모".

> 마감 공고(`JOB_CLOSED`)는 상세에서 `notFound()`가 아니라 **정상 렌더**한다(BR-JOB-02 — 마감도 SEO 자산).
> apply(차단) vs detail(노출)의 비대칭은 의도된 정책이며 회귀 가드로 고정한다.

## 5. 회귀 가드

| 레이어 | 파일 | 보장 |
|--------|------|------|
| 단위 | `not-found-status.test.tsx` | `notFound()` 코드패스 도달(미존재/비숫자/마감) + JOB_NOT_FOUND 외 에러 재전파(5xx 마스킹 방지) + **generateMetadata noindex** + apply 정적 metadata noindex + 마감 공고 정상 렌더 |
| prod E2E | `e2e/prod/soft-404.spec.ts` | (a) 200 **특성 고정**(상위 Next에서 404로 바뀌면 알림 = 본 문서 갱신 트리거), (b) **not-found 응답에 robots noindex 존재**(미티게이션 회귀 가드), (c) 대조군 404 |

prod E2E 실행: `pnpm test:e2e:prod` (config: `playwright.prod.config.ts`, `pnpm build && pnpm start`).
DB 의존 케이스는 `docker compose up -d db minio` + `DATABASE_URL` 필요(미연결 시 런타임 probe로 skip).
status 정확 측정을 위해 `maxRedirects:0`. apply는 비로그인 시 `/login` redirect 선행 → 인증 컨텍스트로 측정.

## 6. 미해결 / 후속 (선택)

- **HTTP 404 status 자체**는 미해결(프레임워크 한계). 향후 Next.js 상위 버전에서 동적 `notFound()` status가
  개선되면(특성 테스트가 실패로 알림) `robots` 의존을 줄이고 status 기반 가드로 전환 가능.
- 미들웨어 기반 형식-검증 404(`/jobs/abc` 등)는 SEO 가치가 낮아(검색엔진이 생성하지 않는 URL) 도입하지 않음.

## 참고

- 근본 원인: Next.js App Router에서 동적 렌더 매칭 라우트의 런타임 `notFound()` HTTP status 동작 (v14.2.35 실측)
- 관련 비즈니스 규칙: BR-JOB-02(마감 공고 SEO 자산 유지), NFR(공고 SSR/SSG + structured data)
- Step 1 PR: #139 (검증 하네스 + 회귀 가드)
