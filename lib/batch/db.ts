// CANDID-029 Step 1 — 배치 DB 연결 헬퍼.
//
// 배치는 cron 등 외부 스케줄러가 트리거하므로, DB가 응답하지 않으면 잡이 무한 대기하다
// 다음 스케줄과 겹쳐 커넥션이 누적될 수 있다. DATABASE_URL에 타임아웃 파라미터가 없으면
// 보수적 기본값을 부여한다(이미 지정된 값은 존중 — 덮어쓰지 않음).

const DEFAULT_CONNECT_TIMEOUT_SEC = '10';
const DEFAULT_SOCKET_TIMEOUT_SEC = '60';

/**
 * DATABASE_URL에 배치용 타임아웃 파라미터(connect_timeout/socket_timeout)를 보수적으로 부여한다.
 * - 이미 지정된 파라미터는 덮어쓰지 않는다.
 * - url이 비었으면 undefined 반환 → PrismaClient가 schema의 env("DATABASE_URL")로 폴백.
 * - 파싱 불가하면 원본을 그대로 반환(부팅을 막지 않음 — env.ts가 이미 url 형식을 검증).
 */
export function withBatchTimeouts(url: string | undefined): string | undefined {
  if (url === undefined || url === '') return undefined;
  try {
    const u = new URL(url);
    if (!u.searchParams.has('connect_timeout')) {
      u.searchParams.set('connect_timeout', DEFAULT_CONNECT_TIMEOUT_SEC);
    }
    if (!u.searchParams.has('socket_timeout')) {
      u.searchParams.set('socket_timeout', DEFAULT_SOCKET_TIMEOUT_SEC);
    }
    return u.toString();
  } catch {
    return url;
  }
}
