import 'server-only';
import { AppError } from '@/lib/errors';

// CANDID-012 Step 2 — OAuth Provider 공통 HTTP 헬퍼.
//
// SSRF 방어 + DoS 차단:
//   - 호출자가 hard-coded provider endpoint만 전달 (사용자 입력 미반영)
//   - 5초 timeout (AbortController)
//   - 1MB 응답 본문 cap (대용량 응답으로 메모리 폭주 차단)
//
// 모든 실패는 AUTH_OAUTH_PROVIDER_ERROR로 수렴 (timing/내용 누수 방지).

const FETCH_TIMEOUT_MS = 5000;
const RESPONSE_BODY_CAP_BYTES = 1 << 20; // 1 MiB

export interface OAuthFetchOptions {
  method: 'GET' | 'POST';
  /** URL은 호출자가 hard-coded provider endpoint만 전달. 사용자 입력 미반영 의무. */
  url: string;
  headers?: Record<string, string>;
  /** POST body — application/x-www-form-urlencoded 또는 application/json (Content-Type은 headers로 지정). */
  body?: string;
}

/**
 * Provider API 호출 + 응답 JSON 파싱. 모든 실패는 AUTH_OAUTH_PROVIDER_ERROR로 수렴.
 *
 * @throws AppError(AUTH_OAUTH_PROVIDER_ERROR) 네트워크 실패 / 5xx / 타임아웃 / 응답 1MB 초과 / JSON 파싱 실패
 */
export async function oauthFetchJson<T = unknown>(opts: OAuthFetchOptions): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(opts.url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      signal: controller.signal,
      // provider 호출은 anonymous — credentials 미전송 (CORS 무관 server-side fetch지만 명시)
      redirect: 'error',
    });
  } catch {
    // AbortError (timeout) / 네트워크 실패 / DNS 실패 등 모두 동일 코드로 수렴
    throw new AppError('AUTH_OAUTH_PROVIDER_ERROR');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new AppError('AUTH_OAUTH_PROVIDER_ERROR');
  }

  // 응답 본문 1MB cap — Content-Length 헤더 우선 검사 후 실제 읽기에서도 확인
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > RESPONSE_BODY_CAP_BYTES) {
    throw new AppError('AUTH_OAUTH_PROVIDER_ERROR');
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new AppError('AUTH_OAUTH_PROVIDER_ERROR');
  }
  if (text.length > RESPONSE_BODY_CAP_BYTES) {
    throw new AppError('AUTH_OAUTH_PROVIDER_ERROR');
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AppError('AUTH_OAUTH_PROVIDER_ERROR');
  }
}
