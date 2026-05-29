// CANDID-020 Step 3 — ResetRequestForm 컴포넌트 테스트 (RTL, jsdom).
//
// 검증 범위 (US-AUTH-004): 이메일 입력 → POST 호출 → 성공 시 균일 안내 메시지,
//   400(형식)·429(과도 요청) 인라인 에러, 빈 입력 가드.
// 모킹 경계: 네트워크 경계인 global fetch만 mock한다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResetRequestForm } from '@/app/password/reset-request/_components/ResetRequestForm';

const UNIFORM = '입력하신 이메일이 가입되어 있다면 재설정 안내 메일을 보냈습니다. 잠시 후 메일함을 확인해 주세요.';

function mockFetch(status: number, body: unknown = {}): Mock {
  const fn = vi.fn(async () => ({
    status,
    json: async () => body,
  })) as unknown as Mock;
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ResetRequestForm', () => {
  it('성공(200) — 서버 균일 메시지 표시 + 폼은 사라짐', async () => {
    const fetchMock = mockFetch(200, { message: UNIFORM });
    const user = userEvent.setup();
    render(<ResetRequestForm />);

    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.click(screen.getByRole('button', { name: '재설정 메일 받기' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(UNIFORM);
    });
    // POST 호출 확인 + 입력 이메일 전달.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({ email: 'user@example.com' });
    // 성공 분기에서는 이메일 입력 폼이 더 이상 렌더되지 않는다.
    expect(screen.queryByLabelText('이메일')).toBeNull();
  });

  it('잘못된 형식(400) — 인라인 에러, 폼 유지', async () => {
    mockFetch(400, { code: 'SYS_VALIDATION_FAILED' });
    const user = userEvent.setup();
    render(<ResetRequestForm />);

    await user.type(screen.getByLabelText('이메일'), 'bad@x');
    await user.click(screen.getByRole('button', { name: '재설정 메일 받기' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('형식');
    });
    expect(screen.getByLabelText('이메일')).toBeInTheDocument();
  });

  it('과도 요청(429) — 안내 메시지', async () => {
    mockFetch(429, { code: 'SYS_RATE_LIMITED' });
    const user = userEvent.setup();
    render(<ResetRequestForm />);

    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.click(screen.getByRole('button', { name: '재설정 메일 받기' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('요청이 너무 많습니다');
    });
  });

  it('빈 이메일 — fetch 미호출 + 필수 입력 안내', async () => {
    const fetchMock = mockFetch(200, { message: UNIFORM });
    const user = userEvent.setup();
    render(<ResetRequestForm />);

    // fireEvent.submit은 native constraint(required) 검증을 우회하고 submit 핸들러를 직접 트리거 →
    // 컴포넌트의 JS 레벨 빈 입력 가드를 검증할 수 있다.
    const form = screen.getByLabelText('이메일').closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('이메일 주소를 입력해 주세요.');
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
