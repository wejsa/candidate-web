// CANDID-016 Step 3 — Resume 첨부 클라이언트 UI (US-APP-003).
//
// 책임:
//   - 파일 선택 (확장자 accept 화이트리스트)
//   - 클라이언트 사전 검증 (크기/MIME)
//   - upload 트리거 (uploadResumeFile)
//   - 진행률 바 + 취소 + 재시도 + 에러 메시지 + 스캔 상태 표시
//
// 보안:
//   - 서버가 정합 검증 재실행 (클라이언트 우회 차단)
//   - presigned URL은 5분 단일 PUT (BR-FILE-05)
//   - storedPath 위변조 차단은 confirm.ts (Step 2 in-PR fix S-MAJOR-1)

'use client';

import { useCallback, useReducer, useRef, useState } from 'react';
import {
  RESUME_ALLOWED_EXTS,
  RESUME_MAX_BYTES,
} from '@/lib/files/validation';
import { HttpStatusError, uploadResumeFile } from '@/lib/files/client';
import {
  canAbort,
  canRetry,
  classifyUploadError,
  INITIAL_UPLOAD_STATE,
  uploadReducer,
} from '@/lib/files/upload-state';

interface Props {
  draftId: number;
  /** 부모 form payload에 첨부 메타를 반영 (Step 2 wiring) */
  onAttached?: (resumeFileId: number) => void;
  /** 첨부 제거/실패 등으로 더 이상 유효 첨부가 없을 때 부모 상태 동기화 */
  onCleared?: () => void;
  /** 루트 fieldset에 주입할 클래스(스타일) */
  className?: string;
}

// accept 속성용 확장자 리스트 ('.pdf,.docx,...' — 사용자 친화).
const ACCEPT_ATTR = RESUME_ALLOWED_EXTS.map((e) => `.${e}`).join(',');
const MAX_MB = RESUME_MAX_BYTES / 1024 / 1024;

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function ResumeUploadStep({ draftId, onAttached, onCleared, className }: Props) {
  const [state, dispatch] = useReducer(uploadReducer, INITIAL_UPLOAD_STATE);
  const [replaced, setReplaced] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // 마지막 선택 파일 — 재시도 시 재사용.
  const lastFileRef = useRef<File | null>(null);

  const performUpload = useCallback(
    async (file: File) => {
      // 클라이언트 사전 검증 (서버가 재실행하지만 UX 향상).
      const ext = file.name.includes('.')
        ? file.name.split('.').pop()!.toLowerCase()
        : '';
      if (!(RESUME_ALLOWED_EXTS as readonly string[]).includes(ext)) {
        dispatch({
          type: 'validate-fail',
          message: `허용된 형식이 아닙니다 (.pdf, .docx, .doc, .hwp, .hwpx만 가능)`,
        });
        return;
      }
      if (file.size > RESUME_MAX_BYTES) {
        dispatch({
          type: 'validate-fail',
          message: `최대 ${MAX_MB}MB까지 업로드 가능합니다.`,
        });
        return;
      }

      // D-MAJOR-3 fix (CANDID-040): 진행 중인 이전 업로드가 있으면 먼저 중단(동시 업로드 race 차단).
      // 입력 disable이 uploading/confirming만 막아 validating 윈도우의 빠른 재선택은 통과 가능 →
      // 이전 AbortController를 abort하지 않고 덮어쓰면 고아 요청이 백그라운드에서 완료돼 stale 결과/순서
      // 역전이 발생할 수 있다. 새 컨트롤러 설정 전에 명시적으로 이전 요청을 취소한다.
      abortRef.current?.abort();

      // AbortController + upload 실행.
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      dispatch({ type: 'upload-start' });

      try {
        const result = await uploadResumeFile({
          draftId,
          file,
          signal: ctrl.signal,
          onProgress: (percent) => dispatch({ type: 'upload-progress', progress: percent }),
        });
        dispatch({ type: 'upload-complete' });
        // D-MAJOR-2 fix (PR #59 in-PR): INFECTED → CLEAN 강제 변환 제거. 정확한 스캔 상태 전달.
        // CLEAN/PENDING은 정상 성공, INFECTED는 reducer가 'infected' 상태 + 오류 메시지로 전이.
        dispatch({
          type: 'confirm-success',
          resumeFileId: result.resumeFileId,
          scanStatus: result.scanStatus,
        });
        if (onAttached !== undefined) onAttached(result.resumeFileId);
      } catch (err) {
        // S-MAJOR-2 fix (PR #59 in-PR): 서버 message 화이트리스트 — 422(validation)만 서버 메시지
        // 사용 (사용자에게 유의미한 형식/크기 안내). 그 외 status는 classifyUploadError의 일반화된
        // 메시지만 사용 — 서버 zod 상세/stack 누출 차단.
        // CANDID-047 fix: finalMsg가 어떤 경로로도 빈 문자열이 되지 않도록 최종 폴백 보강
        // (서버 422 빈 message → 빈 `⚠️ ` alert 렌더 버그 차단). S-MAJOR-2 불변식 유지:
        // 서버 raw message는 validation(422)에서만 사용, 그 외 status는 classify 일반화 메시지.
        const { kind, message } = classifyUploadError(err);
        const serverMsg =
          kind === 'validation' && err instanceof HttpStatusError ? err.message.trim() : '';
        const finalMsg =
          serverMsg !== ''
            ? serverMsg
            : message.trim() !== ''
              ? message
              : '파일을 업로드하지 못했습니다. 다시 시도해 주세요.';
        dispatch({ type: 'fail', kind, message: finalMsg });
      } finally {
        abortRef.current = null;
      }
    },
    [draftId, onAttached],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file === undefined) return;
    lastFileRef.current = file;
    dispatch({
      type: 'select',
      file: { name: file.name, size: file.size, contentType: file.type },
    });
    void performUpload(file);
  };

  const handleAbort = () => {
    abortRef.current?.abort();
  };

  const handleRetry = () => {
    if (lastFileRef.current === null) return;
    void performUpload(lastFileRef.current);
  };

  const handleReplace = () => {
    setReplaced((r) => (state.file !== null ? [...r, state.file.name] : r));
    dispatch({ type: 'reset' });
    lastFileRef.current = null;
    if (fileRef.current !== null) fileRef.current.value = '';
    if (onCleared !== undefined) onCleared();
  };

  return (
    <fieldset aria-label="이력서 첨부" className={className}>
      <legend>이력서 첨부</legend>
      <p>허용 형식: PDF · DOCX · DOC · HWP · HWPX (최대 {MAX_MB}MB)</p>

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT_ATTR}
        onChange={handleFileChange}
        aria-label="이력서 파일 선택"
        disabled={state.status === 'uploading' || state.status === 'confirming'}
      />

      {state.file !== null && (
        <p>
          선택 파일: <strong>{state.file.name}</strong> ({readableSize(state.file.size)})
        </p>
      )}

      {(state.status === 'uploading' || state.status === 'confirming') && (
        <div>
          <progress
            value={state.progress}
            max={100}
            aria-label="업로드 진행률"
            aria-valuenow={state.progress}
            aria-valuemin={0}
            aria-valuemax={100}
          />
          <p aria-live="polite">
            {state.status === 'uploading'
              ? `업로드 중 ${state.progress}%`
              : '서버 등록 중...'}
          </p>
        </div>
      )}

      {state.status === 'scanning' && (
        <p role="status" aria-live="polite">
          업로드 완료. 바이러스 검사 진행 중 — 검사 완료까지 다음 단계로 진행할 수 있습니다.
        </p>
      )}

      {state.status === 'clean' && (
        <p role="status" aria-live="polite">
          업로드 완료 — 바이러스 검사 통과.
        </p>
      )}

      {state.status === 'infected' && (
        // D-MAJOR-2 fix (PR #59 in-PR): INFECTED 명시 표시 — BR-FILE-07 정합.
        <p role="alert">
          ⚠️ {state.errorMessage ?? '바이러스가 감지되어 첨부가 차단되었습니다.'}
        </p>
      )}

      {state.status === 'failed' && state.errorMessage !== null && (
        <p role="alert">⚠️ {state.errorMessage}</p>
      )}

      {state.status === 'aborted' && (
        <p role="status">업로드를 취소했습니다.</p>
      )}

      <div>
        {canAbort(state) && (
          <button type="button" onClick={handleAbort}>
            취소
          </button>
        )}
        {canRetry(state) && lastFileRef.current !== null && (
          <button type="button" onClick={handleRetry}>
            다시 시도
          </button>
        )}
        {(state.status === 'scanning' ||
          state.status === 'clean' ||
          state.status === 'infected' ||
          state.status === 'failed' ||
          state.status === 'aborted') &&
          state.file !== null && (
            <button type="button" onClick={handleReplace}>
              다른 파일로 교체
            </button>
          )}
      </div>

      {replaced.length > 0 && (
        <p>
          교체된 이전 파일: {replaced.length}건 ({replaced[replaced.length - 1]})
        </p>
      )}
    </fieldset>
  );
}
