// CANDID-035 Step 1 — 통합 테스트 setupFiles. 각 워커 시작 시 실행.
//
// 책임:
//   1) DATABASE_URL을 `?schema=test_integration` 파라미터로 override
//      → dev DB와 같은 인스턴스(docker-compose `db`)의 별도 schema 사용 → 비파괴 공존
//   2) PII_ENCRYPTION_KEY를 테스트 전용 고정 32B hex로 강제
//      → 운영 키가 export되어 있어도 누수 위험 0 (tests/setup.ts 패턴 미러)
//
// 마이그레이션 apply는 별도 globalSetup(`global-setup.ts`)에서 1회 실행한다.

const DEFAULT_BASE_URL = 'postgresql://candidate:candidate@localhost:5432/candidate_web';
const TEST_SCHEMA = 'test_integration';

function buildTestDatabaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('schema', TEST_SCHEMA);
  return url.toString();
}

const baseUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_BASE_URL;
process.env.DATABASE_URL = buildTestDatabaseUrl(baseUrl);

// H007(CANDID-008)와 동일 원칙 — `??=`가 아닌 `=` 사용해 운영 키 누수 차단.
process.env.PII_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// CANDID-006 — JWT secret required 격상. Access/Refresh 분리.
process.env.JWT_ACCESS_SECRET = 'test-access-secret-min-32-chars-XXXXXXXX-test-only';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-min-32-chars-YYYYYYYY-test-only';
