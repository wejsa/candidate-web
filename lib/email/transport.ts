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
  const isImplicitTls = env.SMTP_PORT === 465;
  const hasAuth = env.SMTP_USER !== '' && env.SMTP_PASS !== '';

  // Step 1 fix(H001 Sec): STARTTLS 강제 — 서버가 STARTTLS 미지원 응답 시 평문 fallback 차단.
  //   MITM이 STARTTLS를 차단해도 인증 토큰의 평문 SMTP 노출 방지. 465(implicit TLS)에는 N/A.
  // Step 1 fix(H004 Dom): 외부 SMTP 호출 타임아웃 — 호스트 장애 시 promise 누적 방지.
  //   nodemailer 기본값(connection 2분/socket 10분)이 너무 김.
  // 운영은 인증서 검증 강제(rejectUnauthorized: true), dev/test는 self-signed 허용.
  cachedTransporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: isImplicitTls,
    requireTLS: !isImplicitTls,
    tls: {
      // Step 2 fix(MINOR-SEC-1): NODE_ENV SSOT — env.ts의 zod-validated 값 사용.
      rejectUnauthorized: env.NODE_ENV === 'production',
      minVersion: 'TLSv1.2',
    },
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
    // spread 패턴 — SMTP_USER/PASS 둘 다 채워진 경우에만 auth 키 자체를 부착.
    // `auth: undefined` 명시 전달 회피 (테스트 가독성 + 의도 명확).
    ...(hasAuth ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
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
