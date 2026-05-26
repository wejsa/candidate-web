// CANDID-018 Step 1 — application_number 발급기 (BR-APP-05).
// 형식: A-YYYYMM-NNNNN (예: A-202605-00001). 월별 sequence를 row-level lock으로 직렬화.
//
// 패턴:
//   1) updateMany WHERE year_month=? 로 row가 존재하면 last_seq + 1 (L-024 race-free).
//   2) updateMany count === 0 (행 없음)이면 create — race 시 P2002로 분기되어 #1로 재시도.
//
// 호출 시 외부 트랜잭션 client(tx)를 전달하면 같은 트랜잭션에서 직렬화 — submit.ts에서 사용.

import 'server-only';
import { Prisma } from '@prisma/client';
import { basePrisma } from '@/lib/prisma';
import type { ApplicationNumber } from '@/lib/applications/types';

type PrismaLike = typeof basePrisma | Prisma.TransactionClient;

/**
 * Date를 YYYYMM 문자열로 변환 (UTC 기준 — 운영 일관성).
 */
export function toYearMonth(date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1; // 0-based
  return `${y}${String(m).padStart(2, '0')}`;
}

/**
 * application_number 형식: A-YYYYMM-NNNNN (5자리 zero-pad).
 * seq > 99999 시 6자리로 자연 확장 (1년에 99999건 초과 시 운영 모니터링 필요).
 */
function formatApplicationNumber(yearMonth: string, seq: number): string {
  const padded = String(seq).padStart(5, '0');
  return `A-${yearMonth}-${padded}`;
}

/**
 * application_number 발급.
 *
 * D-H001 fix (PR #67 review): UPDATE ... RETURNING으로 atomic single-call 전환.
 * 기존 updateMany + findUnique 분리 호출은 READ COMMITTED 격리에서 두 호출 사이
 * autocommit 경계 race로 잘못된 seq 반환 가능. RETURNING은 같은 statement에서
 * row-level lock + 새 값 회수를 보장한다.
 *
 * 동작:
 *   1) UPDATE ... SET last_seq = last_seq + 1 ... RETURNING last_seq
 *      - 1행 반환 → 새 seq 확정
 *      - 0행 반환 (row 없음) → step 2
 *   2) create 시도 (lastSeq=1) — 동시 race로 P2002면 step 1로 재시도 (최대 3회)
 *
 * 호출 측 트랜잭션 client(tx)를 권장 — 외부 호출 시에도 UPDATE RETURNING은 race-safe.
 */
export async function issueApplicationNumber(
  now: Date = new Date(),
  client: PrismaLike = basePrisma,
): Promise<ApplicationNumber> {
  const yearMonth = toYearMonth(now);

  for (let attempt = 0; attempt < 3; attempt++) {
    // 1) UPDATE ... RETURNING으로 atomic single-call — race-safe.
    // ESLint no-restricted-syntax(D6) — application_number_sequences는 PII 컬럼 미포함.
    // eslint-disable-next-line no-restricted-syntax -- CANDID-018: application_number_sequences PII 없음. atomic UPDATE RETURNING 목적.
    const rows = await client.$queryRaw<{ last_seq: number }[]>`
      UPDATE application_number_sequences
         SET last_seq = last_seq + 1, updated_at = NOW()
       WHERE year_month = ${yearMonth}
      RETURNING last_seq
    `;
    if (rows.length === 1 && rows[0] !== undefined) {
      const seq = rows[0].last_seq;
      return {
        value: formatApplicationNumber(yearMonth, seq),
        parts: { yearMonth, seq },
      };
    }

    // 2) row 없음 — create 시도 (lastSeq=1로 시작)
    try {
      await client.applicationNumberSequence.create({
        data: { yearMonth, lastSeq: 1 },
      });
      return {
        value: formatApplicationNumber(yearMonth, 1),
        parts: { yearMonth, seq: 1 },
      };
    } catch (err) {
      // P2002 race: 다른 트랜잭션이 동일 yearMonth로 먼저 create — 재시도하여 increment
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        continue;
      }
      throw err;
    }
  }
  // 3회 재시도 후에도 실패 — 비정상 (race 폭주 또는 DB 장애)
  throw new Error(
    `Failed to issue application_number after 3 retries (yearMonth=${yearMonth})`,
  );
}
