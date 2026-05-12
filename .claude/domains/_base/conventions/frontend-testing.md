# 프론트엔드 테스트 컨벤션

## 테스트 피라미드

```
        E2E (Playwright)
       ─────────────────
      Integration (페이지)
     ─────────────────────
    Unit (컴포넌트/훅/유틸)
```

| 레벨 | 대상 | 도구 | 비율 |
|------|------|------|------|
| Unit | 컴포넌트, 커스텀 훅, 유틸 함수 | React Testing Library, Vitest/Jest | 70% |
| Integration | 페이지, 폼 흐름, API 연동 | RTL + MSW (API 모킹) | 20% |
| E2E | 사용자 시나리오 (로그인→주문) | Playwright | 10% |

## React Testing Library 패턴

```typescript
// render + screen + userEvent
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

test('장바구니 추가 버튼 클릭 시 onAddToCart 호출', async () => {
  const onAddToCart = vi.fn();
  render(<ProductCard product={mockProduct} onAddToCart={onAddToCart} />);

  await userEvent.click(screen.getByRole('button', { name: '장바구니 추가' }));
  expect(onAddToCart).toHaveBeenCalledWith(mockProduct.id);
});
```

### 쿼리 우선순위
1. `getByRole` — 접근성 기반 (최우선)
2. `getByLabelText` — 폼 요소
3. `getByText` — 텍스트 콘텐츠
4. `getByTestId` — 최후수단

## 파일 위치 및 네이밍

| 파일 | 위치 | 네이밍 |
|------|------|--------|
| 단위 테스트 | 컴포넌트 옆 | `*.test.tsx` |
| 스토리북 | 컴포넌트 옆 | `*.stories.tsx` |
| E2E | `e2e/` 또는 `tests/` | `*.spec.ts` |
| 테스트 유틸 | `test-utils/` | `render.tsx`, `mocks/` |

## 커버리지 목표

| 대상 | 목표 |
|------|------|
| 컴포넌트 | 80%+ |
| 유틸 함수 | 90%+ |
| 커스텀 훅 | 80%+ |
| E2E 시나리오 | 핵심 플로우 100% |
