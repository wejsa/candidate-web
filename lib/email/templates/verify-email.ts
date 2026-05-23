import 'server-only';
import { getEnv } from '@/lib/env';
import type { MailMessage } from '@/lib/email/transport';

// CANDID-010 Step 1 — 이메일 인증 메일 템플릿.
// 입력은 *내부에서 신뢰* (name/token) — 사용자 입력 name은 회원가입 zod 스키마가 사전 검증.
// HTML escape는 출력 시 적용 (간단한 inline escape — CANDID-009 sanitize.ts는 어드민 HTML용).
// CTA 링크: ${NEXT_PUBLIC_APP_URL}/auth/verify?token=... — 24h 유효.

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeUrlComponent(input: string): string {
  return encodeURIComponent(input);
}

export interface VerifyEmailContext {
  /** 받는 사람 이메일 주소. */
  to: string;
  /** 사용자 이름 (UI 인사말). */
  name: string;
  /** 평문 인증 토큰 — URL에 포함. DB에는 sha256 해시만 저장. */
  token: string;
}

/** 인증 메일 메시지 빌드. transport.ts의 sendMail에 그대로 전달 가능. */
export function buildVerifyEmailMessage(ctx: VerifyEmailContext): MailMessage {
  const env = getEnv();
  const verifyUrl = `${env.NEXT_PUBLIC_APP_URL}/auth/verify?token=${escapeUrlComponent(ctx.token)}`;
  const safeName = escapeHtml(ctx.name);
  const safeUrl = escapeHtml(verifyUrl);

  const subject = '[Candidate Web] 이메일 인증을 완료해 주세요';

  const html = `<!DOCTYPE html>
<html lang="ko">
<body style="font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;background:#f5f5f7;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
    <h1 style="font-size:20px;color:#111;margin:0 0 16px;">${safeName}님, 가입을 환영합니다</h1>
    <p style="font-size:14px;color:#333;line-height:1.6;margin:0 0 24px;">
      Candidate Web에 가입해 주셔서 감사합니다. 아래 버튼을 눌러 이메일 인증을 완료해 주세요.
      이 링크는 발송 시점으로부터 <strong>24시간</strong> 동안만 유효합니다.
    </p>
    <p style="margin:0 0 24px;">
      <a href="${safeUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;">이메일 인증 완료</a>
    </p>
    <p style="font-size:12px;color:#666;line-height:1.6;margin:0;">
      버튼이 작동하지 않으면 아래 URL을 브라우저에 직접 붙여 넣어 주세요:<br>
      <span style="word-break:break-all;color:#0066cc;">${safeUrl}</span>
    </p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
    <p style="font-size:12px;color:#999;margin:0;">
      본 메일을 본인이 요청하지 않은 경우 무시하셔도 됩니다. 24시간 후 자동으로 만료됩니다.
    </p>
  </div>
</body>
</html>`;

  const text = `${ctx.name}님, 가입을 환영합니다.

Candidate Web 이메일 인증을 완료하려면 아래 URL을 브라우저에 붙여 넣어 주세요 (24시간 유효):

${verifyUrl}

본 메일을 본인이 요청하지 않은 경우 무시하셔도 됩니다.`;

  return { to: ctx.to, subject, html, text };
}
