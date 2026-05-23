import 'server-only';

// CANDID-036 — fire-and-forget 외부 호출(SMTP 등) catch 핸들러용 PII-safe 직렬화 헬퍼.
//
// CANDID-010 PR #34 H001/M001~M003 fix를 횡단 관심사로 추출:
// - nodemailer는 SMTP 거부 응답(`550 5.1.1 <user@example.com>: ...`)을 Error.message에 합성한다.
// - errName/errMessage만 분리하는 인라인 패턴은 라우터마다 반복되어 누락 위험 영구 존재.
// - 정규식 IDN/quoted-local-part 일부 케이스가 베이스 패턴(`[A-Za-z0-9._%+-]+@...`)에서 누락.
// - 비-Error throw(`throw 'string'`, `throw {code:1}`) 경로에서 `String(err)`는 toString override 우회 위험.
//
// 본 헬퍼는 세 곳을 한 점에서 보호한다 (L-006 3-layer defense-in-depth + L-022 carry 임계 분리).

/** 이메일 형태 문자열을 매칭하는 정규식 — RFC 5322 단순 부분집합 + 따옴표/꺽쇠/공백 외 광범위 커버. */
// 베이스(보수적): /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// 확장(IDN/quoted 일부): 공백/괄호/따옴표를 경계로 사용하면 한글/IDN local-part도 매칭됨.
const EMAIL_PATTERN = /[^\s<>"'`(),;:]+@[^\s<>"'`(),;:]+\.[^\s<>"'`(),;:.]{2,}/g;

export interface MailErrorContext {
  /** Error.name 또는 'Unknown' (비-Error throw 시). */
  errName: string;
  /** Error.message에서 이메일을 redact한 결과. 비-Error throw 시 '<non-error-throw>'. */
  errMessage: string;
  /** nodemailer SMTPError.responseCode 형태(예: 550, 554). 부재 시 null. */
  smtpResponseCode: number | null;
}

/**
 * 외부 호출(SMTP 등) catch 핸들러에서 사용. err 객체에 PII가 섞일 수 있으므로
 * Error 인스턴스만 신뢰하고 메시지 내 이메일을 redact한다.
 *
 * 비-Error throw(`throw {envelope: {to: 'victim@x.com'}}`)는 toString override로
 * PII 우회 가능 — `String(err)` fallback 대신 일괄 '<non-error-throw>'로 대체.
 */
export function summarizeError(err: unknown): MailErrorContext {
  if (err instanceof Error) {
    return {
      errName: err.name,
      errMessage: redactEmails(err.message),
      smtpResponseCode: (err as { responseCode?: number }).responseCode ?? null,
    };
  }
  return {
    errName: 'Unknown',
    errMessage: '<non-error-throw>',
    smtpResponseCode: null,
  };
}

/**
 * 이메일에서 도메인만 추출. zod 검증 통과 보장 없는 경로에서도 안전.
 * '@' 미포함 또는 split 실패 시 'unknown' 폴백.
 */
export function emailDomainOf(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return 'unknown';
  const domain = parts[1]?.trim();
  return domain !== undefined && domain !== '' ? domain : 'unknown';
}

/**
 * 텍스트 내 이메일 형태 문자열을 `<email-redacted>`로 치환.
 * SMTP 응답 본문(`<victim@example.com>`), 따옴표, IDN/punycode 일부 케이스 커버.
 */
export function redactEmails(text: string): string {
  return text.replace(EMAIL_PATTERN, '<email-redacted>');
}
