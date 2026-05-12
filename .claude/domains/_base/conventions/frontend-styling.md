# 프론트엔드 스타일링 컨벤션

## 방식 선택

| 방식 | 사용 시기 | 장점 |
|------|----------|------|
| **CSS Modules** | 스타일 격리 필요, 기존 CSS 활용 | 네이밍 충돌 방지, 번들 최적화 |
| **Tailwind CSS** | 유틸리티 우선, 빠른 프로토타이핑 | 일관된 디자인, 번들 크기 최소화 |

혼용 가능: Tailwind 기본 + CSS Modules 복잡한 애니메이션/레이아웃.

## 디자인 토큰

```css
/* 변수 정의 (CSS Custom Properties) */
:root {
  --color-primary: #2563eb;
  --color-error: #dc2626;
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --radius-md: 0.5rem;
}
```

**하드코딩 금지**: `color: #2563eb` 대신 `color: var(--color-primary)`.

## 반응형

| 브레이크포인트 | 크기 | 대상 |
|---------------|------|------|
| sm | 640px | 모바일 |
| md | 768px | 태블릿 |
| lg | 1024px | 데스크톱 |

**Mobile-first**: 기본 스타일 = 모바일, `@media (min-width:)` 으로 확장.

## 다크 모드

CSS 변수 + `prefers-color-scheme` 또는 클래스 토글 (`.dark`):

```css
:root { --bg: #ffffff; --text: #1a1a1a; }
.dark { --bg: #0a0a0a; --text: #fafafa; }
```

## 금지 패턴

| 패턴 | 사유 |
|------|------|
| `!important` | 우선순위 전쟁 유발 |
| 인라인 `style={{}}` | 동적 계산 외 금지 (재사용 불가) |
| 매직 넘버 (`margin: 13px`) | 토큰 사용 |
| 깊은 중첩 (3단계+) | 선택자 복잡도 증가 |
