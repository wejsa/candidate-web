// CANDID-028 Step 2 — ConfirmModal focus-trap 회귀 테스트 (RTL, jsdom).
// 검증: dialog 시맨틱, ESC→onCancel, 확인/취소 콜백, destructive 버튼 구분, 포커스 진입.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmModal } from '@/app/me/withdraw/_components/ConfirmModal';

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('ConfirmModal', () => {
  it('aria-modal dialog + 제목/안내를 렌더한다', () => {
    render(<ConfirmModal onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: '정말 탈퇴하시겠습니까?' })).toBeInTheDocument();
  });

  it('마운트 시 포커스가 다이얼로그 내부로 진입한다', () => {
    render(<ConfirmModal onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('Escape → onCancel 호출', () => {
    const onCancel = vi.fn();
    render(<ConfirmModal onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('확정 버튼 → onConfirm, destructive(.btn-danger) 스타일', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmModal onConfirm={onConfirm} onCancel={vi.fn()} />);
    const confirm = screen.getByRole('button', { name: '탈퇴 확정' });
    expect(confirm).toHaveClass('btn-danger');
    await userEvent.setup().click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('취소 버튼 → onCancel, .btn-secondary 스타일', async () => {
    const onCancel = vi.fn();
    render(<ConfirmModal onConfirm={vi.fn()} onCancel={onCancel} />);
    const cancel = screen.getByRole('button', { name: '돌아가기' });
    expect(cancel).toHaveClass('btn-secondary');
    await userEvent.setup().click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
