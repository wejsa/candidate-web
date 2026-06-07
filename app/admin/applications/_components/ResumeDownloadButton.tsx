'use client';

// CANDID-066 Step 3 — 이력서 다운로드 버튼(Client).
//   GET /api/admin/v1/applications/{id}/resume → presigned URL 수신 → 새 탭으로 다운로드.
//   서버가 역할/감사/바이러스 게이팅을 최종 강제(클라는 UX). INFECTED는 버튼 대신 차단 배지.

import { useState } from 'react';
import type { VirusScanStatus } from '@prisma/client';
import styles from '../applications.module.css';

export function ResumeDownloadButton({
  applicationId,
  virusScanStatus,
}: {
  applicationId: number;
  virusScanStatus: VirusScanStatus;
}): React.JSX.Element {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 감염 확인 파일은 다운로드 자체를 막는다(서버도 409로 거부 — 이중 방어).
  if (virusScanStatus === 'INFECTED') {
    return (
      <span role="alert" className={styles.scanInfected}>
        ⚠️ 감염이 확인되어 다운로드할 수 없습니다.
      </span>
    );
  }

  async function download(): Promise<void> {
    setPending(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch(`/api/admin/v1/applications/${applicationId}/resume`);
    } catch {
      setPending(false);
      setError('네트워크 오류');
      return;
    }
    setPending(false);
    if (res.ok) {
      const { url } = (await res.json()) as { url: string };
      // presigned URL(짧은 TTL) — Content-Disposition=attachment로 원본 파일명 다운로드.
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (res.status === 403) setError('권한 없음');
    else if (res.status === 409) setError('감염 파일 — 다운로드 차단');
    else if (res.status === 404) setError('파일을 찾을 수 없습니다');
    else setError('다운로드 실패');
  }

  return (
    <span className={styles.downloadWrap}>
      <button
        type="button"
        className={styles.downloadBtn}
        disabled={pending}
        onClick={() => void download()}
      >
        {pending ? '준비 중…' : '이력서 다운로드'}
      </button>
      {error !== null && (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      )}
    </span>
  );
}
