// CANDID-015 Step 1 — 만 나이 검증 SSOT (BR-PII-05).
// Draft PUT (본 task) + 최종 제출(CANDID-018) 양쪽에서 공유.
// 서버 시간대(UTC) 기준 — 일관성 보장. 클라이언트 사전 검증과 동일 로직 유지.

const MS_PER_DAY = 86_400_000;

/**
 * 만 나이 계산 — 생일이 아직 지나지 않았다면 -1 처리.
 *
 * 예: birthDate=2000-05-25, now=2026-05-24 → 25 (생일 1일 전이라 만 25세 아닌 25 - 1 = 25)
 *    birthDate=2000-05-25, now=2026-05-25 → 26 (생일 당일은 만 26세)
 *    birthDate=2000-05-25, now=2026-05-26 → 26
 *
 * 둘 다 UTC 자정 기준이라 시간대 차이는 호출자가 정규화한다.
 */
export function calculateAge(birthDate: Date, now: Date): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birthDate.getUTCDate())) {
    age -= 1;
  }
  return age;
}

/**
 * `YYYY-MM-DD` 형식 birthDate가 minAge 이상인지 검증.
 *
 * - 잘못된 형식(파싱 실패) → false
 * - birthDate가 미래 → false
 * - default minAge=14 (BR-PII-05)
 * - default now=new Date()
 */
export function validateMinAge(birthDate: string, minAge = 14, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return false;
  const ms = Date.parse(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  const bd = new Date(ms);
  // 미래 생년월일 차단
  if (bd.getTime() > now.getTime()) return false;
  return calculateAge(bd, now) >= minAge;
}

/**
 * Date를 `YYYY-MM-DD` ISO date string으로 정규화 (UTC 기준).
 * Draft payload_json 직렬화 일관성 유지.
 */
export function toIsoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** `MIN_AGE_FOR_APPLICATION` 상수 — 개인정보보호법 만 14세 (BR-PII-05). */
export const MIN_AGE_FOR_APPLICATION = 14;
export const MS_PER_DAY_CONST = MS_PER_DAY;
