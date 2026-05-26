// CANDID-018 Step 1 — application_number generator 단위 테스트.
// PR #67 review D-H001 fix: atomic UPDATE RETURNING으로 전환 — $queryRaw mock 사용.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('@/lib/prisma', () => {
  const queryRaw = vi.fn();
  const create = vi.fn();
  return {
    basePrisma: {
      $queryRaw: queryRaw,
      applicationNumberSequence: { create },
    },
    prisma: {},
  };
});

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: {
    $queryRaw: Mock;
    applicationNumberSequence: { create: Mock };
  };
};
const { issueApplicationNumber, toYearMonth } = await import(
  '@/lib/applications/number-generator'
);

beforeEach(() => {
  basePrisma.$queryRaw.mockReset();
  basePrisma.applicationNumberSequence.create.mockReset();
});

describe('toYearMonth', () => {
  it.each([
    ['2026-01-01T00:00:00Z', '202601'],
    ['2026-05-26T23:50:00Z', '202605'],
    ['2026-12-31T23:59:59Z', '202612'],
  ])('UTC %s → %s', (iso, expected) => {
    expect(toYearMonth(new Date(iso))).toBe(expected);
  });
});

describe('issueApplicationNumber (atomic UPDATE RETURNING)', () => {
  const NOW = new Date('2026-05-26T23:50:00Z');

  it('정상 increment 경로 (UPDATE RETURNING 1행): A-202605-00001', async () => {
    basePrisma.$queryRaw.mockResolvedValueOnce([{ last_seq: 1 }]);
    const result = await issueApplicationNumber(NOW);
    expect(result.value).toBe('A-202605-00001');
    expect(result.parts.yearMonth).toBe('202605');
    expect(result.parts.seq).toBe(1);
  });

  it.each([
    [42, 'A-202605-00042'],
    [99998, 'A-202605-99998'],
    [99999, 'A-202605-99999'],
    [100000, 'A-202605-100000'],
    [999999, 'A-202605-999999'],
  ])('seq=%i → %s (5자리 boundary + 6자리 자연 확장)', async (seq, expected) => {
    basePrisma.$queryRaw.mockResolvedValueOnce([{ last_seq: seq }]);
    expect((await issueApplicationNumber(NOW)).value).toBe(expected);
  });

  it('row 없음 → create 신규 seq=1', async () => {
    basePrisma.$queryRaw.mockResolvedValueOnce([]);
    basePrisma.applicationNumberSequence.create.mockResolvedValueOnce({
      yearMonth: '202605',
      lastSeq: 1,
    });
    const result = await issueApplicationNumber(NOW);
    expect(result.value).toBe('A-202605-00001');
    expect(basePrisma.applicationNumberSequence.create).toHaveBeenCalledWith({
      data: { yearMonth: '202605', lastSeq: 1 },
    });
  });

  it('create race (P2002) → 재시도 후 UPDATE RETURNING 성공', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique violation', {
      code: 'P2002',
      clientVersion: 'test',
    });
    basePrisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ last_seq: 2 }]);
    basePrisma.applicationNumberSequence.create.mockRejectedValueOnce(p2002);
    const result = await issueApplicationNumber(NOW);
    expect(result.parts.seq).toBe(2);
    expect(result.value).toBe('A-202605-00002');
  });

  it('3회 재시도 후에도 모두 race → Error throw', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique violation', {
      code: 'P2002',
      clientVersion: 'test',
    });
    basePrisma.$queryRaw.mockResolvedValue([]);
    basePrisma.applicationNumberSequence.create.mockRejectedValue(p2002);
    await expect(issueApplicationNumber(NOW)).rejects.toThrow(/Failed to issue application_number/);
  });

  it('non-P2002 에러는 그대로 throw', async () => {
    basePrisma.$queryRaw.mockResolvedValueOnce([]);
    basePrisma.applicationNumberSequence.create.mockRejectedValueOnce(new Error('db down'));
    await expect(issueApplicationNumber(NOW)).rejects.toThrow('db down');
  });

  it('SQL 텍스트 회귀 가드: UPDATE + RETURNING + application_number_sequences 포함', async () => {
    basePrisma.$queryRaw.mockResolvedValueOnce([{ last_seq: 1 }]);
    await issueApplicationNumber(NOW);
    const args = basePrisma.$queryRaw.mock.calls[0];
    const sqlStrings = args?.[0] as readonly string[] | undefined;
    expect(sqlStrings).toBeDefined();
    const sqlText = (sqlStrings ?? []).join(' ');
    expect(sqlText).toMatch(/UPDATE/i);
    expect(sqlText).toMatch(/RETURNING/i);
    expect(sqlText).toMatch(/application_number_sequences/);
  });
});
