// CANDID-015 Step 1 — Draft 도메인 타입 (US-APP-001/002/005).
// payload_json 구조 SSOT — schemaVersion으로 future-proofing.
//
// SECURITY (CANDID-015 Step 2 L-019, S-MAJOR-1/2 정책 명문화):
// - Draft.payloadJson은 임시 저장 특성상 **평문 PII**(name/phone/birthDate/address)를
//   포함한다. User 컬럼처럼 AES-256-GCM 자동 암호화 가드 대상이 아님 (basePrisma 직접 write).
// - 접근 제한: requireAuth + userId 복합키로 본인 한정 (route 레벨).
// - 응답 마스킹: DraftPrefill은 본인 폼 prefill 전용으로 평문 노출 허용 (BR-PII-01 예외).
//   route GET 응답에 Cache-Control: private, no-store 헤더 부착 의무 (Step 2 구현 검증 대상).
// - 자동 파기: 30일 미제출 Draft는 BR-PII-03에 따라 후속 task(PHASE-3)에서 익명화/삭제.
// - 운영 로그: payloadJson 통째 dump 금지 (감사 로그는 key 목록만).

export type EducationLevel = 'HIGH_SCHOOL' | 'ASSOCIATE' | 'BACHELOR' | 'MASTER' | 'DOCTORATE';
export type CareerLevel = 'NEW' | 'EXPERIENCED';
export type ApplicationStep = 1 | 2 | 3;

/**
 * 인적사항(Step 1) — US-APP-002 필드 정의 그대로.
 * email은 payload에 저장하지 않음 (immutable, User에서 prefill 시점에만 노출).
 */
export interface PersonalInfoPayload {
  name: string;
  // 개인정보 최소수집(US 요청): 지원에는 이름만 필수. 연락처·생년월일은 선택.
  phone?: string;
  birthDate?: string; // YYYY-MM-DD
  address?: string;
  careerLevel: CareerLevel;
  careerMonths?: number;
  education?: EducationLevel;
}

export interface DraftMeta {
  currentStep: ApplicationStep;
  completedSteps: ApplicationStep[];
  lastClientSavedAt?: string; // 클라이언트 timestamp (감사용, 신뢰 X)
}

/**
 * payload_json schemaVersion=1.
 * step2/step3는 CANDID-016~018에서 확장. 본 task는 step1만 채움.
 */
export interface DraftPayloadV1 {
  schemaVersion: 1;
  meta: DraftMeta;
  step1_personal?: PersonalInfoPayload;
  // 미래 확장 (CANDID-016/017/018):
  step2_attachments?: Record<string, unknown>;
  step3_answers?: Record<string, unknown>;
}

/**
 * GET 응답에 포함되는 User PII prefill — payload_json과 별도.
 * email은 immutable (User.email 변경 시 일관성 보장 — payload에 저장 ✗).
 */
export interface DraftPrefill {
  email: string;
  name: string | null;
  phone: string | null; // 평문 (본인 한정 응답)
  birthDate: string | null; // YYYY-MM-DD 평문
}

export interface DraftGetResponse {
  payload: DraftPayloadV1;
  prefill: DraftPrefill;
  version: number;
  lastSavedAt: string; // ISO
}

export interface DraftPutRequest {
  payload: DraftPayloadV1;
  version: number;
}

export interface DraftPutResponse {
  version: number;
  lastSavedAt: string;
}
