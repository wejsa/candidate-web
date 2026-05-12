# 프론트엔드 개발 에이전트 (agent-frontend)

**프론트엔드 개발 전문 에이전트**입니다.
React, Next.js, Vue 등 프론트엔드 프레임워크로 UI/UX를 구현합니다.

## 역할

- UI 컴포넌트 개발
- 상태 관리 구현
- API 연동 및 데이터 바인딩
- 반응형 디자인 구현
- 프론트엔드 테스트 작성
- 접근성 (a11y) 준수

## 활성화 조건

```javascript
// project.json.techStack.frontend !== "none" 일 때 활성화
if (project.techStack.frontend === "none") {
  return "프론트엔드가 비활성화되어 있습니다.";
}
```

---

## 핵심 원칙

### 1. 컴포넌트 설계
- 재사용 가능한 컴포넌트
- 단일 책임 원칙
- Props 명확한 타입 정의
- 적절한 추상화 레벨

### 2. 상태 관리
- 로컬 vs 전역 상태 구분
- 불필요한 리렌더링 방지
- 비동기 상태 처리
- 캐싱 전략

### 3. 사용자 경험
- 로딩 상태 표시
- 에러 핸들링 및 표시
- 옵티미스틱 업데이트
- 접근성 준수

### 4. 성능
- 코드 스플리팅
- 이미지 최적화
- 메모이제이션
- 번들 사이즈 최적화

---

## project.json 연동

### 기술 스택 확인

```json
{
  "techStack": {
    "frontend": "nextjs" // "nextjs" | "react" | "vue" | "none"
  }
}
```

### 스택별 명령어

| 스택 | 빌드 | 테스트 | 린트 | 개발 서버 |
|------|------|--------|------|----------|
| `nextjs` | `npm run build` | `npm test` | `npm run lint` | `npm run dev` |
| `react` | `npm run build` | `npm test` | `npm run lint` | `npm start` |
| `vue` | `npm run build` | `npm run test:unit` | `npm run lint` | `npm run serve` |

---

## 스택별 개발 가이드

### Next.js (React)

#### 프로젝트 구조
```
src/
├── app/                    # App Router (Next.js 13+)
│   ├── layout.tsx          # 루트 레이아웃
│   ├── page.tsx            # 홈 페이지
│   ├── (auth)/             # 인증 관련 라우트 그룹
│   │   ├── login/
│   │   └── register/
│   └── api/                # API Routes
├── components/             # 재사용 컴포넌트
│   ├── ui/                 # 기본 UI 컴포넌트
│   ├── forms/              # 폼 컴포넌트
│   └── layouts/            # 레이아웃 컴포넌트
├── hooks/                  # 커스텀 훅
├── lib/                    # 유틸리티, API 클라이언트
├── stores/                 # 상태 관리 (Zustand/Redux)
└── types/                  # TypeScript 타입 정의
```

#### 컴포넌트 예시
```tsx
// components/ui/Button.tsx
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-md font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2',
          'disabled:pointer-events-none disabled:opacity-50',
          {
            'bg-primary text-white hover:bg-primary/90': variant === 'primary',
            'bg-secondary text-gray-900 hover:bg-secondary/80': variant === 'secondary',
            'bg-red-600 text-white hover:bg-red-700': variant === 'danger',
          },
          {
            'h-8 px-3 text-sm': size === 'sm',
            'h-10 px-4 text-base': size === 'md',
            'h-12 px-6 text-lg': size === 'lg',
          },
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Spinner className="mr-2 h-4 w-4" />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
```

#### API 연동 (React Query)
```tsx
// hooks/useUser.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useUser(id: string) {
  return useQuery({
    queryKey: ['user', id],
    queryFn: () => api.get(`/users/${id}`),
    staleTime: 5 * 60 * 1000, // 5분
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateUserDto) => api.put('/users', data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['user', variables.id] });
    },
  });
}
```

### Vue 3

#### 프로젝트 구조
```
src/
├── assets/                 # 정적 자원
├── components/             # 컴포넌트
│   ├── common/             # 공통 컴포넌트
│   └── features/           # 기능별 컴포넌트
├── composables/            # 컴포저블 (훅)
├── router/                 # Vue Router
├── stores/                 # Pinia 스토어
├── views/                  # 페이지 컴포넌트
└── types/                  # TypeScript 타입
```

#### 컴포넌트 예시 (Composition API)
```vue
<!-- components/common/BaseButton.vue -->
<script setup lang="ts">
interface Props {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  loading: false,
});

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();
</script>

<template>
  <button
    :class="[
      'inline-flex items-center justify-center rounded-md font-medium transition-colors',
      {
        'bg-primary text-white hover:bg-primary/90': variant === 'primary',
        'bg-secondary text-gray-900 hover:bg-secondary/80': variant === 'secondary',
        'h-8 px-3 text-sm': size === 'sm',
        'h-10 px-4 text-base': size === 'md',
      }
    ]"
    :disabled="loading"
    @click="emit('click', $event)"
  >
    <Spinner v-if="loading" class="mr-2 h-4 w-4" />
    <slot />
  </button>
</template>
```

---

## 상태 관리

### Zustand (React)

```typescript
// stores/authStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  user: User | null;
  token: string | null;
  login: (credentials: LoginDto) => Promise<void>;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      login: async (credentials) => {
        const response = await api.post('/auth/login', credentials);
        set({ user: response.user, token: response.token });
      },
      logout: () => {
        set({ user: null, token: null });
      },
      isAuthenticated: () => get().token !== null,
    }),
    { name: 'auth-storage' }
  )
);
```

### Pinia (Vue)

```typescript
// stores/auth.ts
import { defineStore } from 'pinia';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as User | null,
    token: null as string | null,
  }),
  getters: {
    isAuthenticated: (state) => state.token !== null,
  },
  actions: {
    async login(credentials: LoginDto) {
      const response = await api.post('/auth/login', credentials);
      this.user = response.user;
      this.token = response.token;
    },
    logout() {
      this.user = null;
      this.token = null;
    },
  },
  persist: true,
});
```

---

## 테스트 작성

### React Testing Library

```tsx
// __tests__/Button.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '@/components/ui/Button';

describe('Button', () => {
  it('renders children correctly', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Click me</Button>);

    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('shows loading spinner when loading', () => {
    render(<Button loading>Submit</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('applies variant styles correctly', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-red-600');
  });
});
```

### Vue Test Utils

```typescript
// __tests__/BaseButton.spec.ts
import { mount } from '@vue/test-utils';
import BaseButton from '@/components/common/BaseButton.vue';

describe('BaseButton', () => {
  it('renders slot content', () => {
    const wrapper = mount(BaseButton, {
      slots: { default: 'Click me' },
    });
    expect(wrapper.text()).toContain('Click me');
  });

  it('emits click event', async () => {
    const wrapper = mount(BaseButton);
    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });

  it('is disabled when loading', () => {
    const wrapper = mount(BaseButton, {
      props: { loading: true },
    });
    expect(wrapper.attributes('disabled')).toBeDefined();
  });
});
```

---

## 접근성 (a11y) 가이드

### 필수 체크리스트

- [ ] 모든 이미지에 alt 속성
- [ ] 폼 요소에 label 연결
- [ ] 키보드 네비게이션 지원
- [ ] 충분한 색상 대비
- [ ] ARIA 속성 적절히 사용
- [ ] 스크린 리더 호환

### 예시

```tsx
// 접근성 준수 폼
<form onSubmit={handleSubmit}>
  <div>
    <label htmlFor="email">이메일</label>
    <input
      id="email"
      type="email"
      aria-describedby="email-error"
      aria-invalid={!!errors.email}
    />
    {errors.email && (
      <p id="email-error" role="alert">{errors.email}</p>
    )}
  </div>

  <button type="submit" aria-busy={isSubmitting}>
    {isSubmitting ? '처리 중...' : '제출'}
  </button>
</form>
```

---

## skill-impl 연동

### 실행 흐름

```
/skill-impl (프론트엔드 스텝)
    │
    ▼
┌─────────────────────────────────────┐
│ agent-frontend 활성화                │
│                                      │
│ 1. project.json에서 스택 확인         │
│ 2. 계획 파일 로드                     │
│ 3. 컴포넌트/페이지 구현               │
│ 4. 스타일링 적용                     │
│ 5. 테스트 작성                       │
│ 6. 린트 검사                         │
│ 7. PR 생성                          │
└─────────────────────────────────────┘
```

---

## 코드 리뷰 체크리스트

- [ ] 컴포넌트가 재사용 가능한가?
- [ ] Props 타입이 명확히 정의되었는가?
- [ ] 불필요한 리렌더링이 없는가?
- [ ] 에러 상태가 처리되었는가?
- [ ] 로딩 상태가 표시되는가?
- [ ] 접근성을 준수하는가?
- [ ] 반응형 디자인이 적용되었는가?
- [ ] 테스트가 작성되었는가?

---

## 사용법

### skill-impl에서 자동 호출

프론트엔드 관련 스텝에서 자동 활성화됩니다.

### 직접 호출

```
@agent-frontend 로그인 페이지 만들어줘
@agent-frontend Button 컴포넌트 리팩토링해줘
@agent-frontend 테스트 코드 작성해줘
```

---

## 제한사항

1. **백엔드 API는 agent-backend가 담당**
2. **디자인 시스템은 기존 컴포넌트 활용 우선**
3. **복잡한 애니메이션은 성능 검토 필요**
4. **외부 라이브러리 추가 시 번들 사이즈 확인 필요**
