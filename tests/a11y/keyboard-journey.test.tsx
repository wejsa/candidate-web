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
  it('중간 단계: 이전/다음이 실 button + nav 랜드마크이며 Tab으로 도달한다', async () => {
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

  it('첫 단계: 이전 버튼 disabled → Tab은 다음으로 건너뛴다', async () => {
    const user = userEvent.setup();
    render(<StepNavigation currentStep={1} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole('button', { name: '이전' })).toBeDisabled();
    await user.tab();
    expect(screen.getByRole('button', { name: '다음' })).toHaveFocus(); // disabled 이전을 건너뜀
  });

  it('마지막 단계: 다음 버튼은 제출 라벨 + disabled', () => {
    render(<StepNavigation currentStep={3} onPrev={vi.fn()} onNext={vi.fn()} />);
    const submit = screen.getByRole('button', { name: /제출/ });
    expect(submit).toBeDisabled();
    expect(screen.getByRole('button', { name: '이전' })).toBeEnabled();
  });
});

describe('skip-link 배선 (WCAG 2.4.1)', () => {
  // 주석 false-pass 방지(리뷰): 블록/라인/JSX 주석 제거 후 매칭. (layout 주석에 <main id="main-content">가 등장)
  const readStripped = (p: string): string =>
    readFileSync(path.resolve(process.cwd(), p), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

  // 레이아웃 skip-link의 앵커를 추출해 페이지 main id와 상호 일치를 단언(한쪽 오타 검출).
  const layout = readStripped('app/layout.tsx');
  const anchor = layout.match(/href="#([\w-]+)"/)?.[1];

  it('레이아웃 skip-link(.skip-link)가 fragment 앵커를 가리킨다', () => {
    expect(layout).toMatch(/className="skip-link"/);
    expect(anchor).toBeDefined();
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
  ])('%s 의 <main>에 레이아웃 앵커와 동일한 id가 있다', (page) => {
    expect(anchor).toBeDefined();
    expect(readStripped(page)).toMatch(new RegExp(`<main id="${anchor}"`));
  });
});
