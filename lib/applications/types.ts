// CANDID-018 Step 1 — Application 도메인 타입.

export interface ApplicationNumberParts {
  yearMonth: string; // "202605"
  seq: number;       // 1..99999
}

export interface ApplicationNumber {
  /** 발급된 application_number — A-YYYYMM-NNNNN 형식 (총 14자) */
  value: string;
  parts: ApplicationNumberParts;
}

export interface SubmittedApplicationSummary {
  applicationNumber: string;
  submittedAt: string; // ISO 8601
  currentStage: 'SUBMITTED';
}
