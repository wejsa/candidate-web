import type { MailMessage } from '@/lib/email/transport';

// CANDID-029 Step 3 — INFECTED 첨부 자동 삭제 안내 메일 (BR-FILE-04).
//
// server-only 미사용(verify-email.ts와 달리): 야간 배치(tsx CLI)가 import하는 순수 포맷터다.
// `MailMessage`는 type-only import이라 transport.ts의 'server-only' 런타임이 실행되지 않는다.
// 원본 파일명/이름은 사용자 제어 값이므로 HTML 출력 시 escape(이중 방어).

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface InfectedFileContext {
  /** 받는 사람 이메일(파일 소유자). */
  to: string;
  /** 사용자 이름(인사말). */
  name: string;
  /** 삭제된 원본 파일명. */
  filename: string;
}

/** INFECTED 첨부 삭제 안내 메일 메시지를 만든다(발송은 호출측 책임). */
export function buildInfectedFileEmail(ctx: InfectedFileContext): MailMessage {
  const safeName = escapeHtml(ctx.name);
  const safeFile = escapeHtml(ctx.filename);
  const subject = '[채용] 첨부 파일이 보안 검사에서 차단되어 삭제되었습니다';
  const html =
    `<p>${safeName}님,</p>` +
    `<p>업로드하신 첨부 파일 <strong>${safeFile}</strong>이(가) 바이러스 검사에서 ` +
    `악성으로 판정되어 자동 삭제되었습니다.</p>` +
    `<p>안전한 파일로 다시 첨부해 주세요. 문의 사항은 고객센터로 연락 바랍니다.</p>`;
  const text =
    `${ctx.name}님,\n\n` +
    `업로드하신 첨부 파일 "${ctx.filename}"이(가) 바이러스 검사에서 악성으로 판정되어 자동 삭제되었습니다.\n` +
    `안전한 파일로 다시 첨부해 주세요.\n`;
  return { to: ctx.to, subject, html, text };
}
