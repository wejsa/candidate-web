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

  it('SMTP_USER/PASS 빈 값이면 auth 미지정 (Mailtrap 익명 등)', async () => {
    vi.stubEnv('SMTP_USER', '');
    vi.stubEnv('SMTP_PASS', '');
    __resetCachedEnvForTesting();
    __resetMailerCacheForTesting();
    await sendMail({ to: 'a@b.test', subject: 's', html: 'h', text: 't' });
    expect(nm.createTransport).toHaveBeenCalledWith(
      expect.not.objectContaining({ auth: expect.anything() }),
    );
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
