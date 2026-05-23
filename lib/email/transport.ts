import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { getEnv } from '@/lib/env';

// CANDID-010 Step 1 — SMTP 전송 어댑터 (nodemailer).
// 운영: AWS SES / SendGrid / Mailgun 등 SMTP-호환 서비스 사용.
// dev/test: Mailtrap (https://mailtrap.io) 또는 ethereal.email 권장.
// **호출 위치**: Route Handler/Server Action만 (Node runtime). middleware/Edge 금지.
// **트랜잭션 외부**에서 호출 (BR-TX-02) — fire-and-forget 패턴.

let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (cachedTransporter !== null) return cachedTransporter;
  const env = getEnv();
  cachedTransporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // SMTP_PORT=465면 implicit TLS, 587이면 STARTTLS — nodemailer 자동 분기.
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER !== '' && env.SMTP_PASS !== '' ? {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    } : undefined,
  });
  return cachedTransporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * 메일을 발송한다. 발송 실패 시 throw — 호출측이 try/catch로 fire-and-forget 처리.
 * 응답 시간을 막지 않도록 호출측은 `void sendMail(...).catch(log)` 패턴 권장.
 */
export async function sendMail(msg: MailMessage): Promise<void> {
  const env = getEnv();
  const transporter = getTransporter();
  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
}

/**
 * 테스트 전용 — transporter 캐시 초기화 (L-002 패턴).
 * env 변경 후 재로드가 필요한 테스트에서 사용. production 호출 시 throw.
 * @internal
 */
export function __resetMailerCacheForTesting(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('__resetMailerCacheForTesting must not be called in production');
  }
  cachedTransporter = null;
}
