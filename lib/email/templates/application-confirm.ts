// CANDID-018 Step 2 — 지원 완료 확인 이메일 템플릿 (US-APP-006).
// 발송 트리거: submitApplication 트랜잭션 commit 후 fire-and-forget.

import 'server-only';
import { getEnv } from '@/lib/env';
import type { MailMessage } from '@/lib/email/transport';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface ApplicationConfirmContext {
  /** 받는 사람 이메일 주소. */
  to: string;
  /** 지원자 이름 (인사말). 평문 — 호출 측이 신뢰값 보장. */
  name: string;
  /** 발급된 application_number (A-YYYYMM-NNNNN). */
  applicationNumber: string;
}

/**
 * 확인 메일 메시지 빌드. transport.ts의 sendMail에 그대로 전달 가능.
 * NEXT_PUBLIC_APP_URL/applications/{number} 링크는 향후 마이페이지(CANDID-019)에서 활성화.
 */
export function buildApplicationConfirmMessage(ctx: ApplicationConfirmContext): MailMessage {
  const env = getEnv();
  const safeName = escapeHtml(ctx.name);
  const safeNumber = escapeHtml(ctx.applicationNumber);
  const trackUrl = `${env.NEXT_PUBLIC_APP_URL}/mypage/applications/${encodeURIComponent(
    ctx.applicationNumber,
  )}`;

  const subject = `[Candidate Web] 지원이 접수되었습니다 (${ctx.applicationNumber})`;
  const text = [
    `${ctx.name}님, 지원이 정상 접수되었습니다.`,
    ``,
    `지원 번호: ${ctx.applicationNumber}`,
    `진행 상황 확인: ${trackUrl}`,
    ``,
    `채용 절차가 시작되었으며, 단계별 진행 상황은 마이페이지에서 확인하실 수 있습니다.`,
  ].join('\n');
  const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a1a;">지원이 접수되었습니다</h2>
  <p>${safeName}님, 지원이 정상 접수되었습니다.</p>
  <p><strong>지원 번호:</strong> ${safeNumber}</p>
  <p><a href="${escapeHtml(trackUrl)}" style="display: inline-block; padding: 10px 16px; background: #0366d6; color: #fff; text-decoration: none; border-radius: 4px;">진행 상황 확인</a></p>
  <p style="color: #666; font-size: 12px; margin-top: 24px;">채용 절차가 시작되었으며, 단계별 진행 상황은 마이페이지에서 확인하실 수 있습니다.</p>
</body></html>`;

  return { to: ctx.to, subject, text, html };
}
