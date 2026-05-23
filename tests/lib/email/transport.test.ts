import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCachedEnvForTesting } from '@/lib/env';

// nodemailer mock — transporter.sendMail 호출 인자만 검증.
vi.mock('nodemailer', () => {
  const sendMail = vi.fn(async (opts: unknown) => ({ messageId: 'mock-id', accepted: [opts] }));
  const createTransport = vi.fn(() => ({ sendMail }));
  return {
    default: { createTransport },
    createTransport,
    __sendMailMock: sendMail,
  };
});

const nm = (await import('nodemailer')) as unknown as {
  createTransport: ReturnType<typeof vi.fn>;
  __sendMailMock: ReturnType<typeof vi.fn>;
};
const { sendMail, __resetMailerCacheForTesting } = await import('@/lib/email/transport');

beforeEach(() => {
  __resetCachedEnvForTesting();
  __resetMailerCacheForTesting();
  nm.createTransport.mockClear();
  nm.__sendMailMock.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetCachedEnvForTesting();
  __resetMailerCacheForTesting();
});

describe('sendMail', () => {
  it('SMTP_FROM을 from으로 자동 부착하고 인자를 그대로 전달', async () => {
    vi.stubEnv('SMTP_FROM', 'noreply@candidate.test');
    __resetCachedEnvForTesting();
    __resetMailerCacheForTesting();
    await sendMail({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
    expect(nm.__sendMailMock).toHaveBeenCalledTimes(1);
    expect(nm.__sendMailMock).toHaveBeenCalledWith({
      from: 'noreply@candidate.test',
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
  });

  it('SMTP_PORT=465면 secure: true (implicit TLS)', async () => {
    vi.stubEnv('SMTP_PORT', '465');
    __resetCachedEnvForTesting();
    __resetMailerCacheForTesting();
    await sendMail({ to: 'a@b.test', subject: 's', html: 'h', text: 't' });
    expect(nm.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true }),
    );
  });

  it('SMTP_PORT=587(STARTTLS)이면 secure: false', async () => {
    vi.stubEnv('SMTP_PORT', '587');
    __resetCachedEnvForTesting();
    __resetMailerCacheForTesting();
    await sendMail({ to: 'a@b.test', subject: 's', html: 'h', text: 't' });
    expect(nm.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false }),
    );
  });

  it('SMTP_USER/PASS 빈 값이면 auth 키 자체를 부착하지 않음 (Mailtrap 익명 등)', async () => {
    // C001 fix — expect.not.objectContaining({ auth: expect.anything() })는 auth: undefined도 통과해
    // false-positive 발생. mock.calls 첫 인자를 직접 검증하여 auth 키 부재를 명시.
    vi.stubEnv('SMTP_USER', '');
    vi.stubEnv('SMTP_PASS', '');
    __resetCachedEnvForTesting();
    __resetMailerCacheForTesting();
    await sendMail({ to: 'a@b.test', subject: 's', html: 'h', text: 't' });
    const opts = nm.createTransport.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
    expect(opts).toBeDefined();
    expect(opts).not.toHaveProperty('auth');
  });

  it('H007 fix — SMTP_USER/PASS 모두 채워지면 auth 객체 부착 (운영 정상 동작)', async () => {
    vi.stubEnv('SMTP_USER', 'apikey');
    vi.stubEnv('SMTP_PASS', 'SG.example-secret');
    __resetCachedEnvForTesting();
    __resetMailerCacheForTesting();
    await sendMail({ to: 'a@b.test', subject: 's', html: 'h', text: 't' });
    expect(nm.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { user: 'apikey', pass: 'SG.example-secret' },
      }),
    );
  });

  it('H007 fix — SMTP_USER만 있고 PASS 빈 값이면 auth 미부착 (부분 누락 익명 시도)', async () => {
    vi.stubEnv('SMTP_USER', 'user-only');
    vi.stubEnv('SMTP_PASS', '');
    __resetCachedEnvForTesting();
    __resetMailerCacheForTesting();
    await sendMail({ to: 'a@b.test', subject: 's', html: 'h', text: 't' });
    const opts = nm.createTransport.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
    expect(opts).not.toHaveProperty('auth');
  });

  it('H001 fix — STARTTLS 강제 (requireTLS) + TLS 1.2+ + 운영 인증서 검증', async () => {
    vi.stubEnv('SMTP_PORT', '587');
    __resetCachedEnvForTesting();
    __resetMailerCacheForTesting();
    await sendMail({ to: 'a@b.test', subject: 's', html: 'h', text: 't' });
    const opts = nm.createTransport.mock.calls.at(-1)?.[0] as {
      requireTLS?: boolean;
      tls?: { minVersion?: string };
    };
    expect(opts.requireTLS).toBe(true);
    expect(opts.tls?.minVersion).toBe('TLSv1.2');
  });

  it('H001 fix — implicit TLS(465)는 requireTLS=false (이미 TLS)', async () => {
    vi.stubEnv('SMTP_PORT', '465');
    __resetCachedEnvForTesting();
    __resetMailerCacheForTesting();
    await sendMail({ to: 'a@b.test', subject: 's', html: 'h', text: 't' });
    const opts = nm.createTransport.mock.calls.at(-1)?.[0] as {
      requireTLS?: boolean;
      secure?: boolean;
    };
    expect(opts.secure).toBe(true);
    expect(opts.requireTLS).toBe(false);
  });

  it('H004 fix — SMTP 타임아웃 명시 (connection/greeting/socket)', async () => {
    __resetMailerCacheForTesting();
    await sendMail({ to: 'a@b.test', subject: 's', html: 'h', text: 't' });
    const opts = nm.createTransport.mock.calls.at(-1)?.[0] as {
      connectionTimeout?: number;
      greetingTimeout?: number;
      socketTimeout?: number;
    };
    expect(opts.connectionTimeout).toBeGreaterThan(0);
    expect(opts.connectionTimeout).toBeLessThanOrEqual(10_000);
    expect(opts.greetingTimeout).toBeGreaterThan(0);
    expect(opts.socketTimeout).toBeGreaterThan(0);
  });

  it('transporter는 캐시 — 동일 호출 시 createTransport 1회만', async () => {
    await sendMail({ to: 'a@b.test', subject: 's', html: 'h', text: 't' });
    await sendMail({ to: 'c@d.test', subject: 's2', html: 'h2', text: 't2' });
    expect(nm.createTransport).toHaveBeenCalledTimes(1);
    expect(nm.__sendMailMock).toHaveBeenCalledTimes(2);
  });
});

describe('__resetMailerCacheForTesting 가드', () => {
  it('production 호출은 throw', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => __resetMailerCacheForTesting()).toThrow(/must not be called in production/);
  });
});
