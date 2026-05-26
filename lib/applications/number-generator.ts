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
 * application_number 발급. 호출 측 트랜잭션 client(tx)를 권장 — 트랜잭션 외부 호출 시
 * basePrisma 사용하나 sequence row가 다른 트랜잭션에 의해 lock되어 있으면 대기.
 *
 * L-024 패턴: updateMany WHERE 조건절로 INCREMENT — 별도 SELECT FOR UPDATE 불필요.
 * PostgreSQL UPDATE는 row-level exclusive lock을 자동으로 잡음.
 *
 * 동작:
 *   1) 해당 yearMonth row가 있으면 last_seq + 1 (updateMany count=1) → 새 seq 반환
 *   2) row 없음 (count=0): create 시도 → 동시 race로 P2002면 1로 재시도 (최대 3회)
 */
export async function issueApplicationNumber(
  now: Date = new Date(),
  client: PrismaLike = basePrisma,
): Promise<ApplicationNumber> {
  const yearMonth = toYearMonth(now);

  for (let attempt = 0; attempt < 3; attempt++) {
    // 1) row 존재 시 increment
    const updated = await client.applicationNumberSequence.updateMany({
      where: { yearMonth },
      data: { lastSeq: { increment: 1 } },
    });
    if (updated.count === 1) {
      const row = await client.applicationNumberSequence.findUnique({
        where: { yearMonth },
        select: { lastSeq: true },
      });
      if (row === null) {
        // race로 row 삭제됨 — 재시도
        continue;
      }
      return {
        value: formatApplicationNumber(yearMonth, row.lastSeq),
        parts: { yearMonth, seq: row.lastSeq },
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
