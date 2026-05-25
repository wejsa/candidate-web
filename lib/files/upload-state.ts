// CANDID-016 Step 3 — 이력서 업로드 상태 머신 (순수 TS, React 의존 없음).
//
// 상태 전이:
//   idle → validating → uploading → confirming → scanning(=PENDING) / clean(=CLEAN)
//                     ↘ failed (validation/network/server/aborted)
//   * → aborted (사용자 취소)
//
// 책임:
//   - 한 번에 한 업로드만 진행 (replaced 시 이전 abort)
//   - failed/aborted/scanning 상태에서 retry 가능
//   - 외부 에러 메시지를 사용자 친화적 텍스트로 정규화

export type UploadStatus =
  | 'idle' // 파일 미선택
  | 'validating' // 클라이언트 검증 중
  | 'uploading' // S3 PUT 진행 중 (progress 0~100)
  | 'confirming' // confirm API 호출 중
  | 'scanning' // 등록 완료, virus_scan_status=PENDING
  | 'clean' // 스캔 완료 (장래용 — CANDID-029 통합 후 활성)
  | 'infected' // 악성 판정 (장래용)
  | 'failed' // 실패 (errorMessage 보유)
  | 'aborted'; // 사용자 취소

export type UploadFailureKind =
  | 'validation' // 확장자/MIME/크기 위반
  | 'network' // 네트워크/타임아웃
  | 'server' // 서버 5xx/SDK 에러
  | 'conflict' // 409 FILE_ALREADY_EXISTS
  | 'forbidden' // 403/401
  | 'aborted'; // 명시적 취소

export interface UploadFile {
  /** 사용자에게 표시할 원본 파일명 */
  name: string;
  /** bytes */
  size: number;
  /** MIME */
  contentType: string;
}

export interface UploadState {
  status: UploadStatus;
  file: UploadFile | null;
  progress: number; // 0..100
  /** 서버 등록 후 부여되는 resume_files.id (scanning/clean/infected에서 사용) */
  resumeFileId: number | null;
  /** virus_scan_status 표시 — Step 3 시점에는 PENDING만 등장 */
  scanStatus: 'PENDING' | 'CLEAN' | 'INFECTED' | null;
  /** 사용자 노출용 에러 메시지 */
  errorMessage: string | null;
  /** 에러 분류 (UI 분기용) */
  failureKind: UploadFailureKind | null;
}

export const INITIAL_UPLOAD_STATE: UploadState = {
  status: 'idle',
  file: null,
  progress: 0,
  resumeFileId: null,
  scanStatus: null,
  errorMessage: null,
  failureKind: null,
};

export type UploadAction =
  | { type: 'select'; file: UploadFile }
  | { type: 'validate-fail'; message: string }
  | { type: 'upload-start' }
  | { type: 'upload-progress'; progress: number }
  | { type: 'upload-complete' }
  | { type: 'confirm-start' }
  | { type: 'confirm-success'; resumeFileId: number; scanStatus: 'PENDING' | 'CLEAN' }
  | { type: 'fail'; kind: UploadFailureKind; message: string }
  | { type: 'abort' }
  | { type: 'reset' };

/**
 * pure transition — 입력 상태 + 액션 → 새 상태.
 * 의도적으로 모든 상태에서 모든 액션 허용 (UI 호출자가 일관성 책임). 단,
 * progress는 0..100 clamp.
 */
export function uploadReducer(state: UploadState, action: UploadAction): UploadState {
  switch (action.type) {
    case 'select':
      return {
        ...INITIAL_UPLOAD_STATE,
        status: 'validating',
        file: action.file,
      };
    case 'validate-fail':
      return {
        ...state,
        status: 'failed',
        failureKind: 'validation',
        errorMessage: action.message,
        progress: 0,
      };
    case 'upload-start':
      return { ...state, status: 'uploading', progress: 0, errorMessage: null, failureKind: null };
    case 'upload-progress':
      return {
        ...state,
        status: 'uploading',
        progress: Math.max(0, Math.min(100, Math.round(action.progress))),
      };
    case 'upload-complete':
      return { ...state, status: 'confirming', progress: 100 };
    case 'confirm-start':
      return { ...state, status: 'confirming' };
    case 'confirm-success':
      return {
        ...state,
        status: action.scanStatus === 'CLEAN' ? 'clean' : 'scanning',
        progress: 100,
        resumeFileId: action.resumeFileId,
        scanStatus: action.scanStatus,
        errorMessage: null,
        failureKind: null,
      };
    case 'fail':
      return {
        ...state,
        status: action.kind === 'aborted' ? 'aborted' : 'failed',
        failureKind: action.kind,
        errorMessage: action.message,
      };
    case 'abort':
      return {
        ...state,
        status: 'aborted',
        failureKind: 'aborted',
        errorMessage: '업로드를 취소했습니다.',
      };
    case 'reset':
      return INITIAL_UPLOAD_STATE;
  }
}

/**
 * 재시도 가능한 상태인지 — UI "다시 시도" 버튼 활성 조건.
 */
export function canRetry(state: UploadState): boolean {
  return state.status === 'failed' || state.status === 'aborted';
}

/**
 * 진행 중(취소 가능) 상태 — UI "취소" 버튼 활성 조건.
 */
export function canAbort(state: UploadState): boolean {
  return state.status === 'uploading' || state.status === 'confirming';
}

/**
 * 외부 에러 → 사용자 친화 메시지 + 분류.
 */
export function classifyUploadError(err: unknown): { kind: UploadFailureKind; message: string } {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { kind: 'aborted', message: '업로드를 취소했습니다.' };
  }
  // fetch/XHR 에러는 일반 Error 또는 커스텀 객체. status 코드가 있으면 분류.
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status: number }).status;
    if (status === 401 || status === 403) {
      return { kind: 'forbidden', message: '권한이 없습니다. 다시 로그인 후 시도해 주세요.' };
    }
    if (status === 409) {
      return { kind: 'conflict', message: '이미 첨부된 파일이 있습니다. 새로고침 후 다시 시도해 주세요.' };
    }
    if (status === 422) {
      const msg = 'message' in err && typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : '파일이 허용된 형식·크기가 아닙니다.';
      return { kind: 'validation', message: msg };
    }
    if (status >= 500) {
      return { kind: 'server', message: '서버에서 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' };
    }
  }
  if (err instanceof Error && err.name === 'TimeoutError') {
    return { kind: 'network', message: '네트워크가 느립니다. 다시 시도해 주세요.' };
  }
  return { kind: 'network', message: '네트워크 오류가 발생했습니다. 연결을 확인 후 다시 시도해 주세요.' };
}
