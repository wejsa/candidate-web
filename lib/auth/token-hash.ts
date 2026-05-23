import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

// CANDID-010 Step 1 — 토큰 sha256 해시 헬퍼.
// 인증 토큰 / 비밀번호 재설정 / refresh token 등 high-entropy random 토큰 DB 저장 시 사용.
// bcrypt는 검증 빈도 높은 토큰에 과부하 — sha256은 rainbow table 무관(원본이 64+ bits entropy).
// RefreshToken.tokenHash와 동일 패턴 — SSOT 통일.

/** 32 bytes(256 bits) random hex (64 char) — 인증 토큰 발행용. */
export function generateTokenHex(bytes: number = 32): string {
  return randomBytes(bytes).toString('hex');
}

/** SHA-256 hex (64 char). 토큰 발행 시 평문은 URL, 해시는 DB. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
