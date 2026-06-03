// CANDID-028 Step 4 — 키보드 여정 + skip-link 배선 회귀 가드.
// (1) 지원서 단계 이동이 키보드로 도달·조작 가능(실 button + nav 랜드마크).
// (2) skip-link(레이아웃)와 main-content 앵커(전 페이지)가 일관 배선됨(WCAG 2.4.1).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepNavigation } from '@/app/jobs/[id]/apply/_components/StepNavigation';

afterEach(() => {
  cleanup();
});

describe('지원서 단계 이동 키보드 접근', () => {
  it('이전/다음이 실 button + nav 랜드마크이며 Tab으로 도달한다', async () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const user = userEvent.setup();
    render(<StepNavigation currentStep={2} onPrev={onPrev} onNext={onNext} />);

    expect(screen.getByRole('navigation', { name: '단계 이동' })).toBeInTheDocument();
    const prev = screen.getByRole('button', { name: '이전' });
    const next = screen.getByRole('button', { name: '다음' });

    await user.tab();
    expect(prev).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onPrev).toHaveBeenCalledTimes(1);

    await user.tab();
    expect(next).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

describe('skip-link 배선 (WCAG 2.4.1)', () => {
  const read = (p: string): string => readFileSync(path.resolve(process.cwd(), p), 'utf8');

  it('레이아웃 skip-link가 #main-content를 가리킨다', () => {
    const layout = read('app/layout.tsx');
    expect(layout).toMatch(/className="skip-link"/);
    expect(layout).toMatch(/href="#main-content"/);
  });

  it.each([
    'app/page.tsx',
    'app/jobs/page.tsx',
    'app/jobs/[id]/page.tsx',
    'app/jobs/[id]/apply/page.tsx',
    'app/me/page.tsx',
    'app/me/[applicationId]/page.tsx',
    'app/me/profile/page.tsx',
    'app/me/withdraw/page.tsx',
    'app/password/reset/page.tsx',
    'app/password/reset-request/page.tsx',
  ])('%s 의 <main>에 id="main-content" 앵커가 있다', (page) => {
    expect(read(page)).toMatch(/<main id="main-content"/);
  });
});
