import { describe, expect, it } from 'vitest';
import { emailDomainOf, redactEmails, summarizeError } from '@/lib/logging/pii-safe';

describe('summarizeError', () => {
  it('Error 인스턴스 — name/message(redacted)/responseCode 분리', () => {
    const err = new Error('failed to send to victim@example.com');
    const result = summarizeError(err);
    expect(result.errName).toBe('Error');
    expect(result.errMessage).toBe('failed to send to <email-redacted>');
    expect(result.smtpResponseCode).toBeNull();
  });

  it('nodemailer SMTP 거부 응답 형태 — `550 5.1.1 <user@example.com>` 형태 redact', () => {
    const err = new Error('550 5.1.1 <victim@example.com>: Recipient address rejected') as Error & {
      responseCode?: number;
    };
    err.responseCode = 550;
    const result = summarizeError(err);
    expect(result.errMessage).toContain('<email-redacted>');
    expect(result.errMessage).not.toContain('victim@example.com');
    expect(result.smtpResponseCode).toBe(550);
  });

  it('SMTPError-like 객체의 responseCode 추출', () => {
    const err = Object.assign(new Error('Connection refused'), { responseCode: 421 });
    const result = summarizeError(err);
    expect(result.errName).toBe('Error');
    expect(result.smtpResponseCode).toBe(421);
  });

  it('비-Error throw (string) — `<non-error-throw>` 일괄 대체', () => {
    const result = summarizeError('plain string error with hidden@example.com');
    expect(result.errName).toBe('Unknown');
    expect(result.errMessage).toBe('<non-error-throw>');
    expect(result.errMessage).not.toContain('hidden@example.com');
    expect(result.smtpResponseCode).toBeNull();
  });

  it('비-Error throw (object with toString) — PII 우회 차단', () => {
    const nasty = {
      envelope: { to: 'victim@example.com' },
      toString() {
        return `Mail to ${this.envelope.to} rejected`;
      },
    };
    const result = summarizeError(nasty);
    expect(result.errName).toBe('Unknown');
    expect(result.errMessage).toBe('<non-error-throw>');
    expect(result.errMessage).not.toContain('victim');
  });

  it('null/undefined throw', () => {
    expect(summarizeError(null).errMessage).toBe('<non-error-throw>');
    expect(summarizeError(undefined).errMessage).toBe('<non-error-throw>');
  });
});

describe('emailDomainOf', () => {
  it('정상 이메일 — 도메인 추출', () => {
    expect(emailDomainOf('user@example.com')).toBe('example.com');
    expect(emailDomainOf('a.b+tag@sub.example.co.kr')).toBe('sub.example.co.kr');
  });

  it("'@' 미포함 — `unknown` 폴백", () => {
    expect(emailDomainOf('plain-string')).toBe('unknown');
    expect(emailDomainOf('')).toBe('unknown');
  });

  it('도메인부 빈 문자열 — `unknown` 폴백', () => {
    expect(emailDomainOf('user@')).toBe('unknown');
    expect(emailDomainOf('user@   ')).toBe('unknown');
  });

  it("복수 '@' — 잘못된 입력은 `unknown`", () => {
    expect(emailDomainOf('a@b@c')).toBe('unknown');
  });

  it('IDN 도메인 — best-effort 추출 (정규화는 호출측 책임)', () => {
    expect(emailDomainOf('user@한국.kr')).toBe('한국.kr');
  });
});

describe('redactEmails', () => {
  it('일반 이메일 한 개', () => {
    expect(redactEmails('hello user@example.com world')).toBe('hello <email-redacted> world');
  });

  it('여러 이메일 한꺼번에', () => {
    expect(redactEmails('to:a@x.com cc:b@y.com')).toBe('to:<email-redacted> cc:<email-redacted>');
  });

  it('꺽쇠 안의 이메일 (nodemailer SMTP 응답 형태)', () => {
    const input = '550 5.1.1 <victim@example.com>: User unknown';
    const out = redactEmails(input);
    expect(out).not.toContain('victim@example.com');
    expect(out).toContain('<email-redacted>');
  });

  it('IDN 도메인 (한글) — 광범위 정규식 커버', () => {
    const out = redactEmails('mail failed: 사용자@한국.kr rejected');
    expect(out).not.toContain('사용자@한국.kr');
    expect(out).toContain('<email-redacted>');
  });

  it('punycode 도메인', () => {
    const out = redactEmails('to: user@xn--3e0b707e.kr');
    expect(out).not.toContain('user@xn--3e0b707e.kr');
    expect(out).toContain('<email-redacted>');
  });

  it('이메일 없는 일반 텍스트는 변경 없음', () => {
    expect(redactEmails('Connection timeout, no email here')).toBe(
      'Connection timeout, no email here',
    );
  });

  it("'@' 단독 문자는 매칭하지 않음", () => {
    expect(redactEmails('at sign @ alone')).toBe('at sign @ alone');
  });
});
