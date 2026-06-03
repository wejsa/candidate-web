import nodemailer, { type Transporter } from 'nodemailer';
import { getEnv } from '@/lib/env';
import {
  buildInfectedFileEmail,
  type InfectedFileContext,
} from '@/lib/email/templates/infected-file';

// CANDID-029 Step 3 — 배치(CLI) 전용 메일 발송.
//
// lib/email/transport.ts는 'server-only'라 tsx CLI에서 throw하므로(Step 1 prisma / Step 2 S3와
// 동일 boundary) 배치용 최소 transporter를 별도 구성한다. SMTP 설정(STARTTLS/타임아웃)은 동일 시맨틱.

const globalForBatchMail = globalThis as unknown as { __batchMailer?: Transporter | null };

function getTransporter(): Transporter {
  if (globalForBatchMail.__batchMailer) return globalForBatchMail.__batchMailer;
  const env = getEnv();
  const isImplicitTls = env.SMTP_PORT === 465;
  const hasAuth = env.SMTP_USER !== '' && env.SMTP_PASS !== '';
  globalForBatchMail.__batchMailer = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: isImplicitTls,
    requireTLS: !isImplicitTls, // STARTTLS 강제(평문 fallback 차단)
    tls: { rejectUnauthorized: env.NODE_ENV === 'production', minVersion: 'TLSv1.2' },
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
    ...(hasAuth ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
  });
  return globalForBatchMail.__batchMailer;
}

/** INFECTED 파일 삭제 안내 메일 발송. 실패 시 throw — 호출측(virus-scan)이 fire-and-forget 처리. */
export async function notifyInfectedFile(ctx: InfectedFileContext): Promise<void> {
  const env = getEnv();
  const msg = buildInfectedFileEmail(ctx);
  await getTransporter().sendMail({
    from: env.SMTP_FROM,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
}

/** 테스트 전용 — 배치 mailer 캐시 초기화. @internal */
export function __resetBatchMailerForTesting(): void {
  globalForBatchMail.__batchMailer = null;
}
