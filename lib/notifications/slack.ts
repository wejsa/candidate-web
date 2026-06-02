// CANDID-023 Step 4 — 지원 철회 어드민 Slack 알림 (US-MY-003).
//
// BR-TX-02: 트랜잭션 외부에서 fire-and-forget으로 발행 — 철회 트랜잭션 커밋 후 호출자(API)가
//   `void notifyApplicationWithdrawn(...).catch(...)`로 부르며, 실패해도 철회 응답에 영향 없음.
// BR-PII-02: 사유 평문은 외부(Slack)로 전송하지 않는다 — 존재 여부(hasReason)만. 어드민은
//   필요 시 시스템에서 withdraw_reason을 조회한다.
// SLACK_WEBHOOK_URL 미설정 시 no-op. URL은 관리자 설정값이라 SSRF 사용자 입력이 아니다.

import 'server-only';
import { getEnv } from '@/lib/env';

interface WithdrawNotification {
  applicationId: number;
  hasReason: boolean;
}

const TIMEOUT_MS = 3000;

/**
 * 지원 철회를 어드민 Slack 채널에 알린다. 미설정/실패는 조용히 무시(비차단).
 */
export async function notifyApplicationWithdrawn({
  applicationId,
  hasReason,
}: WithdrawNotification): Promise<void> {
  const webhookUrl = getEnv().SLACK_WEBHOOK_URL;
  if (!webhookUrl) return; // 미설정 → no-op

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `📋 지원 #${applicationId} 철회됨 (사유 ${hasReason ? '있음' : '없음'})`,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
