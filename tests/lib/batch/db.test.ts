import { describe, expect, it } from 'vitest';
import { withBatchTimeouts } from '@/lib/batch/db';

// CANDID-029 Step 1 — 배치 DB 연결 헬퍼 단위 테스트.

describe('withBatchTimeouts', () => {
  it('타임아웃 파라미터가 없으면 connect_timeout/socket_timeout을 부여한다', () => {
    const out = withBatchTimeouts('postgresql://u:p@localhost:5432/db');
    const u = new URL(out as string);
    expect(u.searchParams.get('connect_timeout')).toBe('10');
    expect(u.searchParams.get('socket_timeout')).toBe('60');
  });

  it('이미 지정된 파라미터는 덮어쓰지 않는다(사용자 값 존중)', () => {
    const out = withBatchTimeouts('postgresql://u:p@localhost:5432/db?connect_timeout=3');
    const u = new URL(out as string);
    expect(u.searchParams.get('connect_timeout')).toBe('3'); // 보존
    expect(u.searchParams.get('socket_timeout')).toBe('60'); // 보강
  });

  it('빈/undefined url은 undefined 반환(schema env 폴백)', () => {
    expect(withBatchTimeouts(undefined)).toBeUndefined();
    expect(withBatchTimeouts('')).toBeUndefined();
  });

  it('파싱 불가한 url은 원본을 그대로 반환(부팅 미차단)', () => {
    expect(withBatchTimeouts('not a url')).toBe('not a url');
  });
});
