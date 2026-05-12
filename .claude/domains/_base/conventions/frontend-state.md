# 프론트엔드 상태 관리 컨벤션

## 상태 분류

| 구분 | 정의 | 도구 | 예시 |
|------|------|------|------|
| **서버 상태** | API에서 가져온 데이터 (캐시) | React Query, SWR | 상품 목록, 사용자 정보 |
| **클라이언트 상태** | UI 전용 상태 | Zustand, Context | 모달 열림, 사이드바 토글 |
| **폼 상태** | 사용자 입력 | React Hook Form | 회원가입 폼, 검색 필터 |
| **URL 상태** | 라우팅/쿼리 파라미터 | Next.js Router | 페이지네이션, 필터 |

## 원칙

| 원칙 | 설명 |
|------|------|
| 서버 상태는 캐시로 관리 | `useQuery`/`useSWR`로 fetch + 캐시. 전역 상태에 API 응답 저장 금지 |
| 클라이언트 상태 최소화 | 서버에서 파생 가능한 값은 상태로 관리하지 않음 |
| 상태 위치 최소화 | 가장 가까운 공통 부모에 배치, 불필요한 전역화 금지 |
| Derived state 금지 | `useState`로 다른 state에서 계산 가능한 값 저장 금지 → `useMemo` 사용 |

## 서버 상태 패턴 (React Query)

```typescript
// 조회
const { data, isLoading, error } = useQuery({
  queryKey: ['products', filters],
  queryFn: () => fetchProducts(filters),
});

// 변경
const mutation = useMutation({
  mutationFn: createProduct,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
});
```

## 금지 패턴

| 패턴 | 사유 | 대안 |
|------|------|------|
| 전역 상태에 폼 데이터 | 폼은 로컬 관심사 | React Hook Form |
| Prop drilling 3단계+ | 유지보수 어려움 | Context 또는 Zustand |
| useEffect로 상태 동기화 | 무한 루프 위험 | derived state / useMemo |
| Redux 보일러플레이트 | 과도한 복잡성 | Zustand (소규모), React Query (서버 상태) |

## 커스텀 훅 추출 기준

상태 로직이 2곳 이상에서 재사용되거나 컴포넌트가 복잡해지면 커스텀 훅으로 추출:

```typescript
// useProductList.ts
export function useProductList(category: string) {
  return useQuery({
    queryKey: ['products', category],
    queryFn: () => fetchProducts(category),
  });
}
```
