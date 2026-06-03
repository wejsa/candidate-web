// CANDID-050 Step 2 — safeInternalPath open-redirect 가드 단위 테스트.
// 외부 도메인 우회(피싱) 차단이 핵심 — 악성 입력 다수를 커버한다.

import { describe, it, expect } from 'vitest';
import { safeInternalPath } from '@/lib/auth/redirect';

describe('safeInternalPath', () => {
  it('내부 절대경로는 그대로 통과한다', () => {
    expect(safeInternalPath('/jobs/6/apply')).toBe('/jobs/6/apply');
    expect(safeInternalPath('/me')).toBe('/me');
  });

  it('빈 값/널/undefined → fallback(/me)', () => {
    expect(safeInternalPath(undefined)).toBe('/me');
    expect(safeInternalPath(null)).toBe('/me');
    expect(safeInternalPath('')).toBe('/me');
  });

  it('protocol-relative(//evil.com) → fallback', () => {
    expect(safeInternalPath('//evil.com')).toBe('/me');
    expect(safeInternalPath('//evil.com/jobs')).toBe('/me');
  });

  it('절대 URL(http/https) → fallback (슬래시로 시작 안 함)', () => {
    expect(safeInternalPath('https://evil.com')).toBe('/me');
    expect(safeInternalPath('http://evil.com/jobs')).toBe('/me');
  });

  it('backslash 우회(/\\evil.com) → fallback', () => {
    expect(safeInternalPath('/\\evil.com')).toBe('/me');
  });

  it('제어문자(tab/CR/LF) 포함 → fallback', () => {
    expect(safeInternalPath('/\tjobs')).toBe('/me');
    expect(safeInternalPath('/jobs\n')).toBe('/me');
    expect(safeInternalPath('/jobs\r/apply')).toBe('/me');
  });

  it('슬래시로 시작하지 않으면 → fallback', () => {
    expect(safeInternalPath('jobs/6')).toBe('/me');
    expect(safeInternalPath('javascript:alert(1)')).toBe('/me');
  });

  it('인코딩된 슬래시/백슬래시(%2F·%5C, 이중 인코딩 잔재) → fallback', () => {
    expect(safeInternalPath('/%2Fevil.com')).toBe('/me');
    expect(safeInternalPath('/%5Cevil.com')).toBe('/me');
    expect(safeInternalPath('/%2f%2fevil.com')).toBe('/me');
    expect(safeInternalPath('/jobs/%2F%2Fevil.com')).toBe('/me');
  });

  it('과도 길이(>2048) → fallback', () => {
    expect(safeInternalPath('/' + 'a'.repeat(3000))).toBe('/me');
  });

  it('커스텀 fallback을 적용한다', () => {
    expect(safeInternalPath('//evil.com', '/')).toBe('/');
    expect(safeInternalPath(undefined, '/login')).toBe('/login');
  });
});
