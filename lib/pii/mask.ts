// CANDID-008 — PII 응답 마스킹 헬퍼.
// 적용 위치: API serializer 레이어 (Route Handler의 response DTO mapping 단계).
// BR-PII-01: 응답 시 phone "010-****-5678", birth_date "1995-**-**" 형식으로 마스킹.

export function maskPhone(phone: string | null | undefined): string | null {
  if (phone === null || phone === undefined || phone === '') return null;
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length < 9) return null;

  // 휴대폰 11자리: 010-1234-5678 → 010-****-5678
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
  }
  // 서울 지역번호 02 (9~10자리): 02-1234-5678 → 02-****-5678
  if (digits.startsWith('02')) {
    return `02-****-${digits.slice(-4)}`;
  }
  // 지역번호 10자리: 031-123-4567 → 031-***-4567
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-***-${digits.slice(-4)}`;
  }
  // 기타 (9자리 등): 마지막 4자리만 노출.
  return `****-${digits.slice(-4)}`;
}

// === CANDID-034 (CANDID-005 FU1) Step 4 — Application PII snapshot 마스킹 헬퍼 =========

/**
 * 이름 마스킹 — 첫 글자만 노출하고 나머지는 `**`로 처리.
 * '홍길동' → '홍**', 'Kim' → 'K**', 'A' → 'A' (1글자는 그대로), null/empty/공백만 → null.
 * trim 후 적용. 한국어/영문 모두 동일 규칙.
 */
export function maskName(name: string | null | undefined): string | null {
  if (name === null || name === undefined) return null;
  const trimmed = name.trim();
  if (trimmed === '') return null;
  if (trimmed.length === 1) return trimmed;
  return `${Array.from(trimmed)[0]}**`;
}

/**
 * 이메일 마스킹 — local-part의 첫 글자만 노출하고 나머지는 `***` + 도메인 그대로.
 * 'foo@bar.com' → 'f***@bar.com', 'a@bar.com' → 'a***@bar.com'.
 * `@` 부재/local 또는 domain 비어있음 → null (잘못된 형식).
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (email === null || email === undefined) return null;
  const trimmed = email.trim();
  if (trimmed === '') return null;
  const atIdx = trimmed.indexOf('@');
  if (atIdx <= 0 || atIdx >= trimmed.length - 1) return null;
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx); // '@bar.com'
  return `${Array.from(local)[0]}***${domain}`;
}

/**
 * 주소 마스킹 — 공백 기준 처음 2 토큰만 노출하고 이후는 ` ***`로 처리.
 * '서울시 강남구 테헤란로 123' → '서울시 강남구 ***'
 * '서울시 강남구' (2 토큰) → '서울시 강남구' (그대로)
 * '서울시' (1 토큰) → '서울시' (그대로)
 * null/empty/공백만 → null.
 *
 * 한국 도로명/지번/영문 주소 모두 first-2-token 노출 규칙 일관 적용.
 * 정교한 분기(시·구만 노출 등)는 추후 도메인 규칙 정밀화 시 별도 task.
 */
export function maskAddress(address: string | null | undefined): string | null {
  if (address === null || address === undefined) return null;
  const trimmed = address.trim();
  if (trimmed === '') return null;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length <= 2) return tokens.join(' ');
  return `${tokens.slice(0, 2).join(' ')} ***`;
}

export function maskBirthDate(birthDate: string | Date | null | undefined): string | null {
  if (birthDate === null || birthDate === undefined || birthDate === '') return null;

  let isoString: string;
  if (birthDate instanceof Date) {
    if (Number.isNaN(birthDate.getTime())) return null;
    isoString = birthDate.toISOString().slice(0, 10);
  } else {
    isoString = birthDate;
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoString);
  if (m === null) return null;
  const yearStr = m[1];
  const monthStr = m[2];
  const dayStr = m[3];
  if (yearStr === undefined || monthStr === undefined || dayStr === undefined) {
    return null;
  }
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  // CANDID-030 D5/H004: 무효 날짜(예: 1995-13-99, 2026-02-30) 차단 —
  // Date.UTC가 normalize한 결과가 입력과 일치해야 통과.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${yearStr}-**-**`;
}
