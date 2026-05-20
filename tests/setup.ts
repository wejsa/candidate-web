// Vitest 부팅 시점에 실행되는 전역 셋업.
// lib/* 모듈이 import되기 전에 env.ts boot 검증을 통과시키고
// PII 암호화 키를 테스트 전용 값으로 고정한다.
// NODE_ENV는 vitest가 자동으로 'test'로 설정하므로 여기서 다루지 않는다 (readonly 타입).

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test_db';

// 32 bytes hex — 테스트 전용 고정 키.
// H007 fix: ??= 가 아닌 = 사용 — 외부 env에 운영 키가 export되어 있더라도
// 테스트는 항상 고정 키 사용 (운영 키 누수 방지).
process.env.PII_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// CANDID-006 — JWT secret required 격상. 동일 H007 패턴 (운영 시크릿 누수 차단).
// HS512 min(64) 충족 + Access/Refresh 분리 (서로 다른 secret 강제 — env refine).
process.env.JWT_ACCESS_SECRET =
  'test-access-secret-candid006-hs512-min-64-chars-XXXXXXXXXXXXXXXX-only';
process.env.JWT_REFRESH_SECRET =
  'test-refresh-secret-candid006-hs512-min-64-chars-YYYYYYYYYYYYYY-only';
