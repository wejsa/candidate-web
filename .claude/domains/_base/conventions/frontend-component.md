# 프론트엔드 컴포넌트 컨벤션

## 컴포넌트 구조

| 원칙 | 규칙 | 예시 |
|------|------|------|
| 단일 책임 | 파일 1개 = 컴포넌트 1개 | `ProductCard.tsx` |
| 디렉토리 구성 | 관련 파일 같은 폴더 | `ProductCard/index.tsx`, `ProductCard.test.tsx`, `ProductCard.stories.tsx` |
| Barrel export | 디렉토리별 index.ts | `export { ProductCard } from './ProductCard'` |

## 네이밍

| 대상 | 규칙 | 예시 |
|------|------|------|
| 컴포넌트 | PascalCase | `UserProfile`, `OrderSummary` |
| 커스텀 훅 | camelCase + use 접두사 | `useAuth`, `useProductList` |
| 파일명 | PascalCase (컴포넌트) / camelCase (유틸) | `UserProfile.tsx`, `formatDate.ts` |
| 이벤트 핸들러 | handle + 동사 | `handleSubmit`, `handleClick` |
| Props 타입 | 컴포넌트명 + Props | `UserProfileProps` |

## Props 설계

```typescript
// 인터페이스 정의 필수
interface ProductCardProps {
  product: Product;
  onAddToCart: (id: string) => void;
  variant?: 'compact' | 'full';  // 선택적 props에 기본값
}

// destructuring + 기본값
function ProductCard({ product, onAddToCart, variant = 'full' }: ProductCardProps) {
```

## 합성 패턴

| 패턴 | 사용 시기 |
|------|----------|
| children | 단순 래핑, 레이아웃 |
| Render props | 렌더링 로직 위임 |
| Compound | 관련 컴포넌트 그룹 (Tabs, Accordion) |

## 크기 제한

| 라인 수 | 처리 |
|---------|------|
| < 200 | 양호 |
| 200~300 | 경고 — 분리 검토 |
| > 300 | 분리 필수 — 커스텀 훅/하위 컴포넌트 추출 |
