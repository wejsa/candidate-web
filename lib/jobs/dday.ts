// CANDID-014 Step 2 in-task fix (L-019, Step 1 D-MAJOR-2) —
// computeDDay를 list.ts에서 추출. list/detail 양쪽이 동일 진입점으로 import하여 강결합 완화.
// 'server-only' 마킹 없음 — 순수 함수, Prisma/Next 캐시 의존 없음 (RSC + client 양쪽 사용 가능).

/**
 * 마감일 라벨 — 24시간 단위 floor.
 * - closesAt = null → '상시모집'
 * - closesAt < now → null (이미 마감)
 * - 0~24h → '오늘 마감'
 * - 24~48h → 'D-1'
 * - N*24 ~ (N+1)*24h → `D-${N}`
 */
export function computeDDay(closesAt: Date | null, now: Date): string | null {
  if (closesAt === null) return '상시모집';
  const diffMs = closesAt.getTime() - now.getTime();
  if (diffMs < 0) return null;
  const days = Math.floor(diffMs / 86_400_000);
  if (days === 0) return '오늘 마감';
  return `D-${days}`;
}
