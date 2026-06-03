// CANDID-028 Step 1 — vitest-axe matcher 타입 보강.
// vitest-axe@0.1.0의 extend-expect는 구버전 `Vi` 전역 네임스페이스를 augment하지만,
// vitest 2.x는 `'vitest'` 모듈의 Assertion 인터페이스를 사용하므로 직접 보강한다.
// 런타임 등록은 tests/setup.ts의 `expect.extend(axeMatchers)`가 담당한다.

import 'vitest';

interface AxeMatchers<R = unknown> {
  toHaveNoViolations(): R;
}

declare module 'vitest' {
  interface Assertion<T = unknown> extends AxeMatchers<T> {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
