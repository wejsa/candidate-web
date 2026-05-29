// CANDID-039 Step 2 — ResumeUploadStep 컴포넌트 테스트 (RTL, jsdom).
//
// 검증 범위 (US-APP-003): 파일 선택 / 클라이언트 사전 검증 / 진행률 / 취소(abort) /
//   재시도(retry) / 교체(replace) / 스캔 상태 표시.
//
// 회귀 가드 (CANDID-016 carry):
//   - D-MAJOR-2: INFECTED 시 명시 표시 (CLEAN 강제 변환 금지)
//   - S-MAJOR-2: 422(validation)만 서버 message 노출, 그 외 status는 일반화 메시지 (서버 상세 누출 차단)
//
// 모킹 경계: 네트워크 경계인 `uploadResumeFile`만 mock한다. `HttpStatusError`는 컴포넌트가
//   `instanceof`로 분기(ResumeUploadStep:101)하므로 실제 클래스를 보존해야 한다 (importOriginal spread).
//   순수 상태 머신(upload-state.ts: reducer/classify/canAbort/canRetry)은 모킹하지 않는다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RESUME_MAX_BYTES } from '@/lib/files/validation';

vi.mock('@/lib/files/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/files/client')>();
  // uploadResumeFile만 교체 — HttpStatusError(실 클래스) 보존으로 instanceof 경로 유지.
  return { ...actual, uploadResumeFile: vi.fn() };
});

import { HttpStatusError, uploadResumeFile } from '@/lib/files/client';
import { ResumeUploadStep } from '@/app/jobs/[id]/apply/_components/ResumeUploadStep';

const mockUpload = uploadResumeFile as unknown as Mock;

/** jsdom File 생성. size는 content 길이를 따르므로 큰 파일은 override. */
function makeFile(
  name: string,
  type: string,
  sizeOverride?: number,
): File {
  const file = new File(['resume-content'], name, { type });
  if (sizeOverride !== undefined) {
    Object.defineProperty(file, 'size', { value: sizeOverride });
  }
  return file;
}

const pdf = () => makeFile('resume.pdf', 'application/pdf');

function renderStep(onAttached?: (id: number) => void) {
  return render(<ResumeUploadStep draftId={42} onAttached={onAttached} />);
}

function fileInput(): HTMLInputElement {
  return screen.getByLabelText('이력서 파일 선택') as HTMLInputElement;
}

beforeEach(() => {
  mockUpload.mockReset();
});

afterEach(() => {
  // vitest globals 미사용 → RTL 자동 cleanup 미등록. 명시적으로 DOM 정리 (렌더 누적 방지).
  cleanup();
  vi.clearAllMocks();
});

describe('ResumeUploadStep — 파일 선택 + 정상 업로드', () => {
  it('PDF 선택 → 업로드 성공(PENDING) → 스캔 진행 중 표시 + onAttached 호출', async () => {
    mockUpload.mockResolvedValue({ resumeFileId: 7, scanStatus: 'PENDING' });
    const onAttached = vi.fn();
    const user = userEvent.setup();
    renderStep(onAttached);

    await user.upload(fileInput(), pdf());

    expect(await screen.findByText(/바이러스 검사 진행 중/)).toBeInTheDocument();
    expect(screen.getByText('resume.pdf')).toBeInTheDocument();
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: 42, file: expect.any(File) }),
    );
    await waitFor(() => expect(onAttached).toHaveBeenCalledWith(7));
  });
});

describe('ResumeUploadStep — 클라이언트 사전 검증 (서버 호출 차단)', () => {
  it('비허용 확장자 → validate-fail 메시지 + uploadResumeFile 미호출', async () => {
    renderStep();

    // fireEvent.change로 accept 속성 필터를 우회해 컴포넌트 자체 검증 로직을 직접 태운다
    // (userEvent.upload은 accept에 맞지 않는 .exe를 input에 주입하지 않음).
    fireEvent.change(fileInput(), {
      target: { files: [makeFile('malware.exe', 'application/octet-stream')] },
    });

    expect(await screen.findByText(/허용된 형식이 아닙니다/)).toBeInTheDocument();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('최대 크기 초과 → 크기 안내 메시지 + uploadResumeFile 미호출', async () => {
    const user = userEvent.setup();
    renderStep();

    await user.upload(fileInput(), makeFile('big.pdf', 'application/pdf', RESUME_MAX_BYTES + 1));

    expect(await screen.findByText(/최대 .*MB까지 업로드 가능/)).toBeInTheDocument();
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('ResumeUploadStep — 진행률 표시', () => {
  it('onProgress(40) → progressbar aria-valuenow=40 + "업로드 중 40%"', async () => {
    let resolveUpload!: (r: { resumeFileId: number; scanStatus: 'PENDING' }) => void;
    mockUpload.mockImplementation(
      ({ onProgress }: { onProgress?: (p: number) => void }) => {
        onProgress?.(40);
        return new Promise((resolve) => {
          resolveUpload = resolve;
        });
      },
    );
    const user = userEvent.setup();
    renderStep();

    await user.upload(fileInput(), pdf());

    const bar = await screen.findByRole('progressbar', { name: '업로드 진행률' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText('업로드 중 40%')).toBeInTheDocument();

    // 마무리: 업로드 완료시켜 pending 타이머 정리.
    resolveUpload({ resumeFileId: 1, scanStatus: 'PENDING' });
    await screen.findByText(/바이러스 검사 진행 중/);
  });
});

describe('ResumeUploadStep — 취소(abort)', () => {
  it('업로드 중 취소 클릭 → signal abort → "업로드를 취소했습니다."', async () => {
    // signal abort 시 AbortError로 reject → classifyUploadError가 kind="aborted" 매핑.
    mockUpload.mockImplementation(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const user = userEvent.setup();
    renderStep();

    await user.upload(fileInput(), pdf());

    const cancelBtn = await screen.findByRole('button', { name: '취소' });
    await user.click(cancelBtn);

    expect(await screen.findByText('업로드를 취소했습니다.')).toBeInTheDocument();
  });
});

describe('ResumeUploadStep — 재시도(retry)', () => {
  it('실패 후 "다시 시도" → uploadResumeFile 재호출 → 성공', async () => {
    mockUpload
      .mockRejectedValueOnce(new HttpStatusError(500, 'transient'))
      .mockResolvedValueOnce({ resumeFileId: 9, scanStatus: 'PENDING' });
    const user = userEvent.setup();
    renderStep();

    await user.upload(fileInput(), pdf());
    const retryBtn = await screen.findByRole('button', { name: '다시 시도' });

    await user.click(retryBtn);

    expect(await screen.findByText(/바이러스 검사 진행 중/)).toBeInTheDocument();
    expect(mockUpload).toHaveBeenCalledTimes(2);
  });
});

describe('ResumeUploadStep — 교체(replace)', () => {
  it('업로드 후 "다른 파일로 교체" → 초기화 + 교체 이력 표시', async () => {
    mockUpload.mockResolvedValue({ resumeFileId: 3, scanStatus: 'PENDING' });
    const user = userEvent.setup();
    renderStep();

    await user.upload(fileInput(), pdf());
    const replaceBtn = await screen.findByRole('button', { name: '다른 파일로 교체' });

    await user.click(replaceBtn);

    expect(await screen.findByText(/교체된 이전 파일: 1건/)).toBeInTheDocument();
    expect(screen.getByText(/resume\.pdf/)).toBeInTheDocument();
  });
});

describe('ResumeUploadStep — 스캔 상태 표시 (D-MAJOR-2 회귀 가드)', () => {
  it('INFECTED → role="alert" 명시 표시 (CLEAN으로 강제 변환되지 않음)', async () => {
    mockUpload.mockResolvedValue({ resumeFileId: 11, scanStatus: 'INFECTED' });
    const user = userEvent.setup();
    renderStep();

    await user.upload(fileInput(), pdf());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/바이러스가 감지/);
    // CLEAN 표시가 나타나지 않아야 함 (강제 변환 금지).
    expect(screen.queryByText(/바이러스 검사 통과/)).not.toBeInTheDocument();
  });

  it('CLEAN → 검사 통과 표시 / PENDING → 검사 진행 중 표시 (역가드)', async () => {
    mockUpload.mockResolvedValue({ resumeFileId: 12, scanStatus: 'CLEAN' });
    const user = userEvent.setup();
    const { unmount } = renderStep();
    await user.upload(fileInput(), pdf());
    expect(await screen.findByText(/바이러스 검사 통과/)).toBeInTheDocument();
    unmount();

    mockUpload.mockResolvedValue({ resumeFileId: 13, scanStatus: 'PENDING' });
    renderStep();
    await user.upload(fileInput(), pdf());
    expect(await screen.findByText(/바이러스 검사 진행 중/)).toBeInTheDocument();
  });
});

describe('ResumeUploadStep — 서버 메시지 화이트리스트 (S-MAJOR-2 회귀 가드)', () => {
  it('422(validation) → 서버 message 그대로 노출', async () => {
    mockUpload.mockRejectedValue(
      new HttpStatusError(422, '이력서는 PDF 형식만 허용됩니다.', 'FILE_TYPE_NOT_ALLOWED'),
    );
    const user = userEvent.setup();
    renderStep();

    await user.upload(fileInput(), pdf());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('이력서는 PDF 형식만 허용됩니다.');
  });

  it('500(server) → 일반화 메시지만 노출 (서버 상세/stack 누출 차단)', async () => {
    const leak = 'ZodError: expected string at $.fileSize [stack trace ...]';
    mockUpload.mockRejectedValue(new HttpStatusError(500, leak));
    const user = userEvent.setup();
    renderStep();

    await user.upload(fileInput(), pdf());

    const alert = await screen.findByRole('alert');
    // 앵커 정규식으로 일반화 메시지와 '정확히' 일치 — 부분 누출(컬럼명/경로 등)까지 원천 차단.
    expect(alert).toHaveTextContent(
      /^⚠️\s*서버에서 문제가 발생했습니다\. 잠시 후 다시 시도해 주세요\.$/,
    );
    expect(screen.queryByText(/ZodError/)).not.toBeInTheDocument();
    expect(alert).not.toHaveTextContent('$.fileSize');
    expect(alert).not.toHaveTextContent('stack trace');
  });

  it('403(forbidden) → 서버 message 비노출 + 일반화 메시지만 (422 외 누출 차단 완결)', async () => {
    // S-MAJOR-2의 본질은 "422를 제외한 모든 status에서 서버 raw message 누출 차단".
    mockUpload.mockRejectedValue(
      new HttpStatusError(403, 'token sub=user-9931 lacks scope file:write', 'AUTH_FORBIDDEN'),
    );
    const user = userEvent.setup();
    renderStep();

    await user.upload(fileInput(), pdf());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/권한이 없습니다/);
    // 서버가 보낸 권한/주체 식별자는 절대 노출되지 않아야 함.
    expect(screen.queryByText(/user-9931/)).not.toBeInTheDocument();
    expect(alert).not.toHaveTextContent('file:write');
  });
});
