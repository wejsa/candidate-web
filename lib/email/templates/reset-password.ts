import 'server-only';
import { getEnv } from '@/lib/env';
import type { MailMessage } from '@/lib/email/transport';

// CANDID-020 Step 2 — 비밀번호 재설정 메일 템플릿 (US-AUTH-004).
// 입력(name/token)은 내부 신뢰 — name은 가입 시 zod 검증 완료, token은 서버 생성.
// CTA 링크: ${NEXT_PUBLIC_APP_URL}/password/reset?token=... — 30분 유효, 일회용.
// 평문 토큰은 URL에만 노출, DB에는 sha256 해시만 저장.

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

export interface ResetPasswordContext {
  /** 받는 사람 이메일 주소. */
  to: string;
  /** 사용자 이름 (UI 인사말). */
  name: string;
  /** 평문 재설정 토큰 — URL에 포함. DB에는 sha256 해시만 저장. */
  token: string;
}

/** 비밀번호 재설정 메일 메시지 빌드. transport.ts의 sendMail에 그대로 전달 가능. */
export function buildResetPasswordMessage(ctx: ResetPasswordContext): MailMessage {
  const env = getEnv();
  const resetUrl = `${env.NEXT_PUBLIC_APP_URL}/password/reset?token=${escapeUrlComponent(ctx.token)}`;
  const safeName = escapeHtml(ctx.name);
  const safeUrl = escapeHtml(resetUrl);

  const subject = '[Candidate Web] 비밀번호 재설정 안내';

  const html = `<!DOCTYPE html>
<html lang="ko">
<body style="font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;background:#f5f5f7;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
    <h1 style="font-size:20px;color:#111;margin:0 0 16px;">${safeName}님, 비밀번호 재설정 요청</h1>
    <p style="font-size:14px;color:#333;line-height:1.6;margin:0 0 24px;">
      비밀번호 재설정 요청이 접수되었습니다. 아래 버튼을 눌러 새 비밀번호를 설정해 주세요.
      이 링크는 발송 시점으로부터 <strong>30분</strong> 동안만 유효하며, 한 번만 사용할 수 있습니다.
    </p>
    <p style="margin:0 0 24px;">
      <a href="${safeUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;">비밀번호 재설정</a>
    </p>
    <p style="font-size:12px;color:#666;line-height:1.6;margin:0;">
      버튼이 작동하지 않으면 아래 URL을 브라우저에 직접 붙여 넣어 주세요:<br>
      <span style="word-break:break-all;color:#0066cc;">${safeUrl}</span>
    </p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
    <p style="font-size:12px;color:#999;margin:0;">
      본 메일을 본인이 요청하지 않은 경우 무시하셔도 됩니다. 비밀번호는 변경되지 않으며, 링크는 30분 후 자동 만료됩니다.
    </p>
  </div>
</body>
</html>`;

  const text = `${ctx.name}님, 비밀번호 재설정 요청이 접수되었습니다.

새 비밀번호를 설정하려면 아래 URL을 브라우저에 붙여 넣어 주세요 (30분 유효, 1회용):

${resetUrl}

본 메일을 본인이 요청하지 않은 경우 무시하셔도 됩니다. 비밀번호는 변경되지 않습니다.`;

  return { to: ctx.to, subject, html, text };
}
