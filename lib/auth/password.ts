import 'server-only';
import bcrypt from 'bcryptjs';

// CANDID-010 Step 1 — 비밀번호 해시/검증 (BR-AUTH-02 BCrypt strength 12).
// bcryptjs(pure JS) — Node 20 환경 ~250ms/12rounds. 트랜잭션 *외부*에서 호출 (DB 커넥션 점유 회피).
// 평문/해시 모두 로그/응답 노출 금지 — 호출측은 throw 시 cause/message에 평문 포함 금지.
// timing attack 방어는 bcrypt.compare가 자체 제공 (상수 시간 비교).

const STRENGTH = 12;

/**
 * 평문 비밀번호를 BCrypt strength 12 해시로 변환. ~250ms.
 * 호출측은 트랜잭션 진입 *전*에 호출하여 DB 커넥션 점유를 회피한다.
 */
export async function hashPassword(plain: string): Promise<string> {
  // bcrypt 자체 입력 길이 제한(72 bytes) — 호출측 zod 스키마가 사전 검증하지만 방어적 가드.
  if (plain.length === 0) {
    throw new Error('password must not be empty');
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
