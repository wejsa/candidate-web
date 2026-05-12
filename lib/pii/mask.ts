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

export function maskBirthDate(birthDate: string | Date | null | undefined): string | null {
  if (birthDate === null || birthDate === undefined || birthDate === '') return null;

  let isoString: string;
  if (birthDate instanceof Date) {
    if (Number.isNaN(birthDate.getTime())) return null;
    isoString = birthDate.toISOString().slice(0, 10);
  } else {
    isoString = birthDate;
  }

  const match = isoString.match(/^(\d{4})-\d{2}-\d{2}/);
  if (!match) return null;
  return `${match[1]}-**-**`;
}
