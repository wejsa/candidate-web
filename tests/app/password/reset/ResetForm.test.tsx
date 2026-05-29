// CANDID-020 Step 5 — ResetForm 컴포넌트 테스트 (RTL, jsdom).
//
// 검증: 토큰 부재 → 재요청 안내, 성공 200, 토큰 무효(400)/만료(410) → 재요청 안내,
//   비밀번호 불일치 클라 가드, 네트워크 실패. 모킹 경계: global fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResetForm } from '@/app/password/reset/_components/ResetForm';

const STRONG = 'NewPassw0rd!';

function mockFetch(status: number, body: unknown = {}): Mock {
  const fn = vi.fn(async () => ({ status, json: async () => body })) as unknown as Mock;
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function fillAndSubmit(pw = STRONG, confirm = STRONG): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('새 비밀번호'), pw);
  await user.type(screen.getByLabelText('새 비밀번호 확인'), confirm);
  await user.click(screen.getByRole('button', { name: '비밀번호 변경' }));
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ResetForm', () => {
  it('토큰 부재 — 즉시 재요청 안내 + 폼 미렌더', () => {
    render(<ResetForm token="" />);
    expect(screen.getByRole('alert')).toHaveTextContent('유효하지 않거나 만료');
    expect(screen.getByRole('link', { name: '재설정 메일 다시 요청하기' })).toBeInTheDocument();
    expect(screen.queryByLabelText('새 비밀번호')).toBeNull();
  });

  it('성공(200) — 변경 완료 안내 + 로그인 링크 + 폼 사라짐', async () => {
    const fetchMock = mockFetch(200, { message: 'ok' });
    render(<ResetForm token={'a'.repeat(64)} />);
    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('모든 기기에서 로그아웃');
    });
    expect(screen.getByRole('link', { name: '로그인하러 가기' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as { body: string };
    expect(JSON.parse(init.body)).toMatchObject({ token: 'a'.repeat(64), password: STRONG });
  });

  it('토큰 무효(400 AUTH_RESET_TOKEN_INVALID) — 재요청 안내로 전환', async () => {
    mockFetch(400, { code: 'AUTH_RESET_TOKEN_INVALID' });
    render(<ResetForm token={'a'.repeat(64)} />);
    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('유효하지 않거나 만료');
    });
    expect(screen.getByRole('link', { name: '재설정 메일 다시 요청하기' })).toBeInTheDocument();
  });

  it('토큰 만료(410 AUTH_RESET_TOKEN_EXPIRED) — 재요청 안내', async () => {
    mockFetch(410, { code: 'AUTH_RESET_TOKEN_EXPIRED' });
    render(<ResetForm token={'a'.repeat(64)} />);
    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: '재설정 메일 다시 요청하기' })).toBeInTheDocument();
    });
  });

  it('강도 미달(400, 비토큰 코드) — errWeak 인라인 + 폼 유지', async () => {
    mockFetch(400, { code: 'SYS_VALIDATION_FAILED' });
    render(<ResetForm token={'a'.repeat(64)} />);
    // minLength native 제약 우회 위해 일치하는 값 입력 후 form submit 직접 트리거.
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('새 비밀번호'), STRONG);
    await user.type(screen.getByLabelText('새 비밀번호 확인'), STRONG);
    fireEvent.submit(screen.getByLabelText('새 비밀번호').closest('form')!);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('3종 이상');
    });
    // 인라인 에러 — 재요청 안내로 전환되지 않고 폼 유지.
    expect(screen.getByLabelText('새 비밀번호')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '재설정 메일 다시 요청하기' })).toBeNull();
  });

  it('과도 요청(429) — errRateLimited 인라인 + 폼 유지', async () => {
    mockFetch(429, { code: 'SYS_RATE_LIMITED' });
    render(<ResetForm token={'a'.repeat(64)} />);
    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('요청이 너무 많습니다');
    });
    expect(screen.getByLabelText('새 비밀번호')).toBeInTheDocument();
  });

  it('서버 오류(500) — errGeneric 인라인 + 폼 유지', async () => {
    mockFetch(500, { code: 'SYS_INTERNAL_ERROR' });
    render(<ResetForm token={'a'.repeat(64)} />);
    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('잠시 후 다시 시도해 주세요.');
    });
    expect(screen.getByLabelText('새 비밀번호')).toBeInTheDocument();
  });

  it('비밀번호 불일치 — 클라이언트 가드, fetch 미호출', async () => {
    const fetchMock = mockFetch(200, {});
    render(<ResetForm token={'a'.repeat(64)} />);
    await fillAndSubmit(STRONG, 'Different0!');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('일치하지 않습니다');
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('네트워크 실패 — 일반 안내 + 폼 유지', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    render(<ResetForm token={'a'.repeat(64)} />);
    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('잠시 후 다시 시도해 주세요.');
    });
    expect(screen.getByLabelText('새 비밀번호')).toBeInTheDocument();
  });
});
