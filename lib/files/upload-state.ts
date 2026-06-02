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
  | {
      type: 'confirm-success';
      resumeFileId: number;
      // D-MAJOR-2 fix (PR #59 in-PR): INFECTED도 명시 허용 — UI에서 정확히 표시 (강제 변환 금지).
      scanStatus: 'PENDING' | 'CLEAN' | 'INFECTED';
    }
  | { type: 'fail'; kind: UploadFailureKind; message: string }
  | { type: 'abort' }
  | { type: 'reset' };

// A-MAJOR-2 fix (CANDID-040): dev-only 비정상 전이 경고.
// reducer는 의도적으로 모든 전이를 허용하지만(UI 호출자가 일관성 책임), 개발 중 예기치 않은
// (status, action) 조합을 조기에 드러내 호출 순서 버그를 잡기 위한 가드. 순수성 유지 — 상태는
// 바꾸지 않고 console.warn만 출력하며, production에서는 no-op(번들·런타임 비용 0 지향).
const ALWAYS_ALLOWED: ReadonlySet<UploadAction['type']> = new Set(['reset', 'select', 'abort']);
const VALID_TRANSITIONS: Record<UploadStatus, ReadonlySet<UploadAction['type']>> = {
  idle: new Set(),
  validating: new Set(['validate-fail', 'upload-start']),
  uploading: new Set(['upload-progress', 'upload-complete', 'fail']),
  confirming: new Set(['confirm-start', 'confirm-success', 'fail']),
  scanning: new Set(),
  clean: new Set(),
  infected: new Set(),
  failed: new Set(['upload-start']), // 재시도 경로(performUpload 재호출)
  aborted: new Set(['upload-start']), // 재시도 경로
};

export function warnIfInvalidTransition(state: UploadState, action: UploadAction): void {
  if (process.env.NODE_ENV === 'production') return;
  if (ALWAYS_ALLOWED.has(action.type)) return;
  if (VALID_TRANSITIONS[state.status].has(action.type)) return;
  // eslint-disable-next-line no-console
  console.warn(
    `[upload-state] 예기치 않은 전이: status="${state.status}" + action="${action.type}". ` +
      'UI 호출 순서를 확인하세요 (dev 전용 경고 · 상태는 정상 처리됨).',
  );
}

/**
 * pure transition — 입력 상태 + 액션 → 새 상태.
 * 의도적으로 모든 상태에서 모든 액션 허용 (UI 호출자가 일관성 책임). 단,
 * progress는 0..100 clamp. dev에서는 비정상 전이를 warnIfInvalidTransition으로 경고.
 */
export function uploadReducer(state: UploadState, action: UploadAction): UploadState {
  warnIfInvalidTransition(state, action);
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
      // D-MAJOR-2 fix (PR #59 in-PR): INFECTED 명시 상태 전이 — BR-FILE-07 정합.
      return {
        ...state,
        status:
          action.scanStatus === 'INFECTED'
            ? 'infected'
            : action.scanStatus === 'CLEAN'
              ? 'clean'
              : 'scanning',
        progress: 100,
        resumeFileId: action.resumeFileId,
        scanStatus: action.scanStatus,
        errorMessage:
          action.scanStatus === 'INFECTED'
            ? '바이러스가 감지되어 첨부가 차단되었습니다. 다른 파일을 첨부해 주세요.'
            : null,
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
      // CANDID-047 fix: 서버가 422를 빈/공백 message로 응답하면 빈 alert가 렌더되므로
      // (빈 문자열도 string이라 기존 폴백이 발동하지 않음) trim 후 비어 있으면 폴백 사용.
      const raw =
        'message' in err && typeof (err as { message?: unknown }).message === 'string'
          ? (err as { message: string }).message
          : '';
      const msg = raw.trim() !== '' ? raw : '파일이 허용된 형식·크기가 아닙니다.';
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
