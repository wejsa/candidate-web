import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { buildVerifyEmailMessage } from '@/lib/email/templates/verify-email';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://candidate.example.com');
  __resetCachedEnvForTesting();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetCachedEnvForTesting();
});

describe('buildVerifyEmailMessage', () => {
  it('verify URL은 NEXT_PUBLIC_APP_URL + /auth/verify?token=...', () => {
    const msg = buildVerifyEmailMessage({
      to: 'user@example.com',
      name: '홍길동',
      token: 'abc123def',
    });
    expect(msg.to).toBe('user@example.com');
    expect(msg.subject).toContain('이메일 인증');
    expect(msg.html).toContain('https://candidate.example.com/auth/verify?token=abc123def');
    expect(msg.text).toContain('https://candidate.example.com/auth/verify?token=abc123def');
  });

  it('이름 HTML escape — <script>이 그대로 들어가지 않음', () => {
    const msg = buildVerifyEmailMessage({
      to: 'a@b.test',
      name: '<script>alert(1)</script>',
      token: 't',
    });
    expect(msg.html).not.toContain('<script>alert(1)</script>');
    expect(msg.html).toContain('&lt;script&gt;');
  });

  it('토큰의 URL-unsafe 문자는 encodeURIComponent (예: 공백/+/=)', () => {
    const msg = buildVerifyEmailMessage({
      to: 'a@b.test',
      name: 'X',
      token: 'has space+plus=eq',
    });
    expect(msg.html).toContain('token=has%20space%2Bplus%3Deq');
    expect(msg.text).toContain('token=has%20space%2Bplus%3Deq');
  });

  it('HTML과 text 모두 포함되어야 (멀티파트 호환)', () => {
    const msg = buildVerifyEmailMessage({ to: 'a@b.test', name: 'X', token: 't' });
    expect(msg.html.length).toBeGreaterThan(0);
    expect(msg.text.length).toBeGreaterThan(0);
    expect(msg.text).not.toContain('<'); // plain text는 HTML 태그 없음
  });

  it('한글 이름/이모지 보존', () => {
    const msg = buildVerifyEmailMessage({
      to: 'a@b.test',
      name: '홍길동 🚀',
      token: 't',
    });
    expect(msg.html).toContain('홍길동 🚀');
    expect(msg.text).toContain('홍길동 🚀');
  });

  it('subject는 plain text (HTML escape 불필요)', () => {
    const msg = buildVerifyEmailMessage({ to: 'a@b.test', name: 'X', token: 't' });
    expect(msg.subject).not.toContain('<');
    expect(msg.subject).not.toContain('&lt;');
  });
});
