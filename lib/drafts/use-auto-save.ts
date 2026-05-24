// CANDID-015 Step 4 — 자동 저장 client hook (US-APP-005).
//
// 저장 트리거:
//   1. debounce 3s (입력 후 마지막 3초)
//   2. interval 30s (입력 활성 시 30초 주기)
//   3. saveNow() — 외부 트리거 (수동 저장 / 스텝 이동 강제)
// beforeunload — dirty 시 경고
// 4xx/5xx 응답은 비차단 토스트 (BR-APP-07)
// 409 APP_DRAFT_CONFLICT 시 자동 저장 일시정지 + 사용자 액션 대기
//
// CANDID-015 Step 4 L-019 (D-MAJOR-1): client-side zod 가드 후 PUT — 부분 입력은 자동 저장
// 시도 자체를 회피하여 서버 400 루프 차단.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DraftPayloadV1Schema } from '@/lib/drafts/schema';
import type { DraftPayloadV1, DraftPutResponse } from '@/lib/drafts/types';

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'failed' | 'conflict';

interface Options {
  jobPostingId: number;
  initialVersion: number;
  initialLastSavedAt: string;
  /** test/SSR용 fetch 주입 — 기본은 글로벌 fetch */
  fetcher?: typeof fetch;
  /** debounce ms (기본 3000). 0이면 비활성. */
  debounceMs?: number;
  /** interval ms (기본 30000). 0이면 비활성. */
  intervalMs?: number;
}

interface State {
  status: AutoSaveStatus;
  version: number;
  lastSavedAt: string;
  errorMessage: string | null;
}

interface Api extends State {
  /** payload 변경 알림 (부분 입력 OK — zod 가드는 hook 내부). */
  notifyChange: (payload: DraftPayloadV1) => void;
  /** 외부 트리거 — 수동 저장 / 스텝 이동 강제 저장. */
  saveNow: () => Promise<void>;
  /** beforeunload 경고 토글 — dirty 여부 노출. */
  isDirty: boolean;
}

export function useAutoSave({
  jobPostingId,
  initialVersion,
  initialLastSavedAt,
  fetcher,
  debounceMs = 3000,
  intervalMs = 30000,
}: Options): Api {
  const [state, setState] = useState<State>({
    status: 'idle',
    version: initialVersion,
    lastSavedAt: initialLastSavedAt,
    errorMessage: null,
  });
  const [isDirty, setIsDirty] = useState(false);

  // 최신 payload + version 참조용 ref (closure stale 방지)
  const payloadRef = useRef<DraftPayloadV1 | null>(null);
  const versionRef = useRef(initialVersion);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // conflict 시 자동 저장 일시정지
  const pausedRef = useRef(false);
  // 인플라이트 요청 중복 방지
  const inflightRef = useRef(false);

  const doFetch = fetcher ?? (typeof fetch !== 'undefined' ? fetch : null);

  const performSave = useCallback(async (): Promise<void> => {
    if (pausedRef.current || inflightRef.current || payloadRef.current === null) return;
    // CANDID-015 Step 4 L-019 (D-MAJOR-1): zod 가드 후 PUT — 부분 입력은 저장 회피
    const parseResult = DraftPayloadV1Schema.safeParse(payloadRef.current);
    if (!parseResult.success) return;

    inflightRef.current = true;
    setState((s) => ({ ...s, status: 'saving' }));
    try {
      if (doFetch === null) throw new Error('fetch unavailable');
      const res = await doFetch(`/api/v1/drafts/${jobPostingId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: parseResult.data, version: versionRef.current }),
      });
      if (res.status === 409) {
        pausedRef.current = true;
        setState((s) => ({ ...s, status: 'conflict', errorMessage: '다른 곳에서 변경됨' }));
        return;
      }
      if (!res.ok) {
        setState((s) => ({ ...s, status: 'failed', errorMessage: `HTTP ${res.status}` }));
        return;
      }
      const body = (await res.json()) as DraftPutResponse;
      versionRef.current = body.version;
      setState({
        status: 'saved',
        version: body.version,
        lastSavedAt: body.lastSavedAt,
        errorMessage: null,
      });
      setIsDirty(false);
    } catch (err) {
      // 네트워크 실패 — 비차단 (BR-APP-07)
      setState((s) => ({
        ...s,
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : 'unknown',
      }));
    } finally {
      inflightRef.current = false;
    }
  }, [doFetch, jobPostingId]);

  const notifyChange = useCallback(
    (payload: DraftPayloadV1) => {
      payloadRef.current = payload;
      setIsDirty(true);
      if (debounceMs > 0) {
        if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          void performSave();
        }, debounceMs);
      }
    },
    [debounceMs, performSave],
  );

  const saveNow = useCallback(async () => {
    if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current);
    await performSave();
  }, [performSave]);

  // interval 주기 저장
  useEffect(() => {
    if (intervalMs <= 0) return;
    intervalTimerRef.current = setInterval(() => {
      if (isDirty) void performSave();
    }, intervalMs);
    return () => {
      if (intervalTimerRef.current !== null) clearInterval(intervalTimerRef.current);
    };
  }, [intervalMs, isDirty, performSave]);

  // beforeunload 경고
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        // 일부 브라우저 호환: returnValue 설정
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // unmount cleanup
  useEffect(
    () => () => {
      if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current);
      if (intervalTimerRef.current !== null) clearInterval(intervalTimerRef.current);
    },
    [],
  );

  return { ...state, notifyChange, saveNow, isDirty };
}
