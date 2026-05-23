import 'server-only';
import bcrypt from 'bcryptjs';

// CANDID-010 Step 1 — 비밀번호 해시/검증 (BR-AUTH-02 BCrypt strength 12).
// bcryptjs(pure JS) — Node 20 환경 ~250ms/12rounds. 트랜잭션 *외부*에서 호출 (DB 커넥션 점유 회피).
// 평문/해시 모두 로그/응답 노출 금지 — 호출측은 throw 시 cause/message에 평문 포함 금지.
// timing attack 방어는 bcrypt.compare가 자체 제공 (상수 시간 비교).

const STRENGTH = 12;
/** bcrypt 입력 한계 — 72 bytes 초과분은 silent truncate. UTF-8 한글 24자 = 72 bytes. */
const MAX_PASSWORD_BYTES = 72;

/**
 * 평문 비밀번호를 BCrypt strength 12 해시로 변환. ~250ms.
 * 호출측은 트랜잭션 진입 *전*에 호출하여 DB 커넥션 점유를 회피한다.
 *
 * Step 1 fix(H003/H006): UTF-8 byte 길이 가드 — zod 사전 검증(72 char) 외 경로(스크립트/관리자
 * 직접 호출)에서도 silent truncation을 명시 throw로 방어. 한글 multi-byte는 24자에서 72 bytes 도달.
 */
export async function hashPassword(plain: string): Promise<string> {
  if (plain.length === 0) {
    throw new Error('password must not be empty');
  }
  if (Buffer.byteLength(plain, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new Error(`password must be at most ${MAX_PASSWORD_BYTES} bytes in UTF-8`);
  }
  return bcrypt.hash(plain, STRENGTH);
}

/**
 * 평문과 저장된 해시의 일치 여부. timing-safe 비교(bcrypt 내부).
 * 해시가 비어 있거나 형식이 잘못되면 false (throw 회피 — 호출측이 invalid credentials로 일관 처리).
 */
export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (hash === null || hash === undefined || hash === '') return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
