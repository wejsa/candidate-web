// Vitest 부팅 시점에 실행되는 전역 셋업.
// lib/* 모듈이 import되기 전에 env.ts boot 검증을 통과시키고
// PII 암호화 키를 테스트 전용 값으로 고정한다.
// NODE_ENV는 vitest가 자동으로 'test'로 설정하므로 여기서 다루지 않는다 (readonly 타입).

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test_db';

// 32 bytes hex — 테스트 전용 고정 키. 실제 운영 키와 절대 동일하면 안 됨.
process.env.PII_ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
