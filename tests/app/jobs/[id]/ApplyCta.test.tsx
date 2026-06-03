// CANDID-050 Step 1 — ApplyCta 상태별 목적지 회귀 테스트 (RTL, jsdom).
// 핵심 회귀(P3): ALREADY_APPLIED의 "마이페이지에서 확인"이 존재하지 않는 /mypage가 아니라
//   실제 라우트 /me로 이동해야 한다. GUEST는 redirect 보존하며 /login으로 이동.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ApplyCta } from '@/app/jobs/[id]/_components/ApplyCta';

const JOB_ID = 7;
const APPLY_PATH = '/jobs/7/apply';

afterEach(() => {
  cleanup();
});

describe('ApplyCta 상태별 목적지', () => {
  it('GUEST — /login?redirect=<apply path> 로 이동(redirect 보존)', () => {
    render(<ApplyCta jobId={JOB_ID} state="GUEST" />);
    const cta = screen.getByRole('button', { name: '로그인하고 지원하기' });
    expect(cta).toHaveAttribute(
      'href',
      `/login?redirect=${encodeURIComponent(APPLY_PATH)}`,
    );
  });

  it('APPLY — 지원 폼으로 이동', () => {
    render(<ApplyCta jobId={JOB_ID} state="APPLY" />);
    expect(screen.getByRole('button', { name: '지원하기' })).toHaveAttribute('href', APPLY_PATH);
  });

  it('RESUME_DRAFT — 이어서 작성하기로 지원 폼 이동', () => {
    render(<ApplyCta jobId={JOB_ID} state="RESUME_DRAFT" />);
    expect(screen.getByRole('button', { name: '이어서 작성하기' })).toHaveAttribute(
      'href',
      APPLY_PATH,
    );
  });

  it('ALREADY_APPLIED — 비활성 "지원 완료" + 마이페이지 링크는 /me (회귀: /mypage 아님)', () => {
    render(<ApplyCta jobId={JOB_ID} state="ALREADY_APPLIED" applicationNumber="A-202606-00007" />);
    expect(screen.getByRole('button', { name: '지원 완료' })).toBeDisabled();
    const mypage = screen.getByRole('link', { name: /마이페이지에서/ });
    expect(mypage).toHaveAttribute('href', '/me');
    expect(mypage).not.toHaveAttribute('href', '/mypage');
  });

  it('CLOSED — 비활성 "지원 마감" + 지원/로그인 링크 없음', () => {
    render(<ApplyCta jobId={JOB_ID} state="CLOSED" />);
    expect(screen.getByRole('button', { name: '지원 마감' })).toBeDisabled();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
