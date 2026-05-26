// CANDID-018 Step 1 — application_number generator 단위 테스트.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('@/lib/prisma', () => {
  const updateMany = vi.fn();
  const findUnique = vi.fn();
  const create = vi.fn();
  return {
    basePrisma: {
      applicationNumberSequence: { updateMany, findUnique, create },
    },
    prisma: {},
  };
});

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: {
    applicationNumberSequence: { updateMany: Mock; findUnique: Mock; create: Mock };
  };
};
const { issueApplicationNumber, toYearMonth } = await import(
  '@/lib/applications/number-generator'
);

beforeEach(() => {
  basePrisma.applicationNumberSequence.updateMany.mockReset();
  basePrisma.applicationNumberSequence.findUnique.mockReset();
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

describe('issueApplicationNumber', () => {
  const NOW = new Date('2026-05-26T23:50:00Z');

  it('정상 increment 경로: A-202605-00001', async () => {
    basePrisma.applicationNumberSequence.updateMany.mockResolvedValueOnce({ count: 1 });
    basePrisma.applicationNumberSequence.findUnique.mockResolvedValueOnce({ lastSeq: 1 });
    const result = await issueApplicationNumber(NOW);
    expect(result.value).toBe('A-202605-00001');
    expect(result.parts.yearMonth).toBe('202605');
    expect(result.parts.seq).toBe(1);
  });

  it('두 자리 seq: A-202605-00042', async () => {
    basePrisma.applicationNumberSequence.updateMany.mockResolvedValueOnce({ count: 1 });
    basePrisma.applicationNumberSequence.findUnique.mockResolvedValueOnce({ lastSeq: 42 });
    const result = await issueApplicationNumber(NOW);
    expect(result.value).toBe('A-202605-00042');
  });

  it('5자리 seq boundary: 99999', async () => {
    basePrisma.applicationNumberSequence.updateMany.mockResolvedValueOnce({ count: 1 });
    basePrisma.applicationNumberSequence.findUnique.mockResolvedValueOnce({ lastSeq: 99999 });
    expect((await issueApplicationNumber(NOW)).value).toBe('A-202605-99999');
  });

  it('5자리 초과 시 6자리로 자연 확장', async () => {
    basePrisma.applicationNumberSequence.updateMany.mockResolvedValueOnce({ count: 1 });
    basePrisma.applicationNumberSequence.findUnique.mockResolvedValueOnce({ lastSeq: 100000 });
    expect((await issueApplicationNumber(NOW)).value).toBe('A-202605-100000');
  });

  it('row 없음 → create 신규 seq=1', async () => {
    basePrisma.applicationNumberSequence.updateMany.mockResolvedValueOnce({ count: 0 });
    basePrisma.applicationNumberSequence.create.mockResolvedValueOnce({ yearMonth: '202605', lastSeq: 1 });
    const result = await issueApplicationNumber(NOW);
    expect(result.value).toBe('A-202605-00001');
    expect(basePrisma.applicationNumberSequence.create).toHaveBeenCalledWith({
      data: { yearMonth: '202605', lastSeq: 1 },
    });
  });

  it('create race (P2002) → 재시도 후 increment 성공', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique violation', {
      code: 'P2002',
      clientVersion: 'test',
    });
    basePrisma.applicationNumberSequence.updateMany
      .mockResolvedValueOnce({ count: 0 }) // 1차: 없음
      .mockResolvedValueOnce({ count: 1 }); // 2차: 재시도 (다른 tx가 create 후 row 존재)
    basePrisma.applicationNumberSequence.create.mockRejectedValueOnce(p2002);
    basePrisma.applicationNumberSequence.findUnique.mockResolvedValueOnce({ lastSeq: 2 });
    const result = await issueApplicationNumber(NOW);
    expect(result.parts.seq).toBe(2);
    expect(result.value).toBe('A-202605-00002');
  });

  it('3회 재시도 후에도 모두 race → Error throw', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique violation', {
      code: 'P2002',
      clientVersion: 'test',
    });
    basePrisma.applicationNumberSequence.updateMany.mockResolvedValue({ count: 0 });
    basePrisma.applicationNumberSequence.create.mockRejectedValue(p2002);
    await expect(issueApplicationNumber(NOW)).rejects.toThrow(/Failed to issue application_number/);
  });

  it('non-P2002 에러는 그대로 throw', async () => {
    basePrisma.applicationNumberSequence.updateMany.mockResolvedValueOnce({ count: 0 });
    basePrisma.applicationNumberSequence.create.mockRejectedValueOnce(new Error('db down'));
    await expect(issueApplicationNumber(NOW)).rejects.toThrow('db down');
  });

  it('updateMany count=1이지만 findUnique=null (race로 row 삭제) → 재시도', async () => {
    basePrisma.applicationNumberSequence.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    basePrisma.applicationNumberSequence.findUnique
      .mockResolvedValueOnce(null) // 1차 race
      .mockResolvedValueOnce({ lastSeq: 5 });
    const result = await issueApplicationNumber(NOW);
    expect(result.parts.seq).toBe(5);
  });
});
