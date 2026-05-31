// CANDID-022 Step 2 — 회원 탈퇴 (US-AUTH-005, BR-PII-03/04, BR-AUTH-05).

/**
 * 탈퇴 처리 결과 분기 — BR-PII-03 (활성/완료/미존재 applications).
 *
 * - `anonymized`: applications 존재(IN_PROGRESS 또는 종결 모두 포함) → User row 보존 + PII NULL +
 *   email rotate. 채용 평가 기록 보존, BR-PII-04 1년 배치(CANDID-029)가 일괄 파기.
 * - `hard_deleted`: applications 0건 → User row DELETE + CASCADE (auth_providers, refresh_tokens,
 *   drafts, email_verifications, password_reset_tokens, idempotency_keys). ResumeFile orphan 사전 정리.
 */
export type WithdrawMode = 'anonymized' | 'hard_deleted';

/** withdrawUser 진입 파라미터. */
export interface WithdrawInput {
  /** 본인 인증 통과한 사용자 ID. */
  userId: number;
  /** 비밀번호 보유 사용자(passwordHash NOT NULL) 필수. 소셜 전용은 undefined. */
  passwordConfirmation?: string | null;
  /** 탈퇴 사유 (선택). AuditLog metadataJson에 길이만 기록 — 평문은 저장하지 않음. */
  reason?: string | null;
  /** 감사 메타데이터. */
  userAgent?: string | null;
  ipAddress?: string | null;
}

/** withdrawUser 응답 — Route Handler가 클라이언트로 전파할 필드 집합. */
export interface WithdrawResult {
  mode: WithdrawMode;
  userId: number;
  /** revokeAllForUser가 무효화한 활성 RefreshToken 수 (감사 로그용). */
  revokedSessionCount: number;
  /** 익명화/삭제 트랜잭션 commit 시각. */
  withdrawnAt: Date;
}

// === CANDID-024 Step 1 — 프로필 조회 DTO (US-MY-004) ==============================
//
// 응답에는 평문 PII를 절대 포함하지 않는다 (BR-PII-01 / L-006 PII 3-layer defense).
// phone은 maskPhone 결과(string | null)만, passwordHash는 boolean(hasPassword)으로만 노출한다.

export type ProfileProviderName = 'google' | 'github';

export interface ProfileProvider {
  provider: ProfileProviderName;
  /** 연결 시각 (ISO 8601). */
  linkedAt: string;
}

export interface ProfileDto {
  name: string;
  email: string;
  /** 마스킹된 연락처 (예: '010-****-5678'). 미등록 시 null. 평문은 노출하지 않는다. */
  phoneMasked: string | null;
  /** 비밀번호 설정 여부 — 소셜 전용 계정 식별 + 비번 변경 폼 분기용. 해시는 노출하지 않는다. */
  hasPassword: boolean;
  /** 연결된 소셜 계정 목록 (연결일 오름차순). */
  providers: ProfileProvider[];
}
