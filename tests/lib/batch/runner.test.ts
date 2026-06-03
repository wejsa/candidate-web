import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { describeError, defaultCleanupTasks, runNightlyCleanup } from '@/lib/batch/runner';
import type { CleanupTask } from '@/lib/batch/types';

// CANDID-029 Step 1 — 배치 러너 단위 테스트.
// 핵심 보장: 태스크별 격리(부분 실패가 전체를 중단시키지 않음) + 집계 정확성 + PII-free 에러 식별.

const NOW = new Date('2026-06-03T00:00:00.000Z');
const fakeDb = {} as unknown as PrismaClient;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('describeError', () => {
  it('Error.name과 code를 결합하되 free-text message는 노출하지 않는다(PII-free)', () => {
    const err = Object.assign(new Error('user victim@example.com not found'), { code: 'P2025' });
    expect(describeError(err)).toBe('Error(P2025)');
    expect(describeError(err)).not.toContain('victim@example.com');
  });

  it('code 없는 Error는 name만 반환', () => {
    expect(describeError(new TypeError('boom'))).toBe('TypeError');
  });

  it('code가 빈 문자열이면 name만 반환(code 미노출)', () => {
    expect(describeError(Object.assign(new Error('msg'), { code: '' }))).toBe('Error');
  });

  it('비-Error throw는 UnknownError', () => {
    expect(describeError('string throw')).toBe('UnknownError');
    expect(describeError({ secret: 'x' })).toBe('UnknownError');
  });
});

describe('runNightlyCleanup', () => {
  it('모든 태스크 성공 시 집계 + hasError=false', async () => {
    const tasks: CleanupTask[] = [
      { name: 'a', run: vi.fn().mockResolvedValue(3) },
      { name: 'b', run: vi.fn().mockResolvedValue(5) },
    ];

    const result = await runNightlyCleanup(fakeDb, NOW, tasks);

    expect(result.totalDeleted).toBe(8);
    expect(result.hasError).toBe(false);
    expect(result.tasks.map((t) => [t.name, t.deleted, t.error])).toEqual([
      ['a', 3, null],
      ['b', 5, null],
    ]);
  });

  it('한 태스크가 throw해도 나머지는 계속 실행된다(격리)', async () => {
    const taskC = { name: 'c', run: vi.fn().mockResolvedValue(2) };
    const tasks: CleanupTask[] = [
      { name: 'a', run: vi.fn().mockResolvedValue(1) },
      {
        name: 'b',
        run: vi.fn().mockRejectedValue(Object.assign(new Error('db down'), { code: 'P1001' })),
      },
      taskC,
    ];

    const result = await runNightlyCleanup(fakeDb, NOW, tasks);

    expect(taskC.run).toHaveBeenCalledOnce(); // 실패 뒤 태스크도 실행됨
    expect(result.hasError).toBe(true);
    expect(result.totalDeleted).toBe(3); // 1 + 0(실패) + 2
    const b = result.tasks.find((t) => t.name === 'b');
    expect(b?.deleted).toBe(0);
    expect(b?.error).toBe('Error(P1001)');
  });

  it('각 태스크에 주입된 db와 now를 그대로 전달한다', async () => {
    const run: Mock = vi.fn().mockResolvedValue(0);
    await runNightlyCleanup(fakeDb, NOW, [{ name: 'x', run }]);
    expect(run).toHaveBeenCalledWith(fakeDb, NOW);
  });

  it('모든 태스크 실패 시 totalDeleted=0, hasError=true', async () => {
    const tasks: CleanupTask[] = [
      { name: 'a', run: vi.fn().mockRejectedValue(new Error('x')) },
      { name: 'b', run: vi.fn().mockRejectedValue(new Error('y')) },
    ];

    const result = await runNightlyCleanup(fakeDb, NOW, tasks);

    expect(result.totalDeleted).toBe(0);
    expect(result.hasError).toBe(true);
    expect(result.tasks.every((t) => t.error !== null)).toBe(true);
  });

  it('태스크가 비어 있으면 totalDeleted=0, hasError=false', async () => {
    const result = await runNightlyCleanup(fakeDb, NOW, []);

    expect(result.totalDeleted).toBe(0);
    expect(result.hasError).toBe(false);
    expect(result.tasks).toEqual([]);
  });
});

describe('defaultCleanupTasks', () => {
  it('정리 5종을 고정 순서로 등록한다', () => {
    expect(defaultCleanupTasks().map((t) => t.name)).toEqual([
      'expired-email-verifications',
      'expired-password-reset-tokens',
      'expired-idempotency-keys',
      'stale-drafts',
      'pending-virus-scans',
    ]);
  });

  it('각 태스크는 대응하는 정리 함수에 위임한다(델리게이트 호출 검증)', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = {
      emailVerification: { findMany, deleteMany: vi.fn() },
      passwordResetToken: { findMany, deleteMany: vi.fn() },
      idempotencyKey: { findMany, deleteMany: vi.fn() },
      applicationDraft: { findMany, deleteMany: vi.fn(), delete: vi.fn() },
      resumeFile: { findMany, deleteMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
      user: { findUnique: vi.fn() },
    } as unknown as PrismaClient;

    const tasks = defaultCleanupTasks();
    for (const task of tasks) {
      await task.run(db, NOW);
    }
    // 5 태스크 각각 자신의 델리게이트 findMany를 1회씩 호출(빈 결과로 즉시 종료) → 총 5회.
    expect(findMany).toHaveBeenCalledTimes(5);
  });
});
