// CANDID — 포트폴리오 링크 섹션 (지원서 단일 페이지). 선택 입력.
//
// PUT /api/v1/drafts/{jobId}/portfolios 로 링크 배열 전체를 저장(서버가 SSRF/도메인 화이트리스트 재검증).
// linkType별 허용 도메인은 서버가 강제 — UI는 placeholder로 힌트만 제공.

'use client';

import { useState } from 'react';
import styles from '@/app/jobs/[id]/apply/apply.module.css';

const LINK_TYPE_OPTIONS = [
  { value: 'GITHUB', label: 'GitHub', hint: 'https://github.com/…' },
  { value: 'NOTION', label: 'Notion', hint: 'https://…notion.site/…' },
  { value: 'BLOG', label: '블로그', hint: 'https://…' },
  { value: 'LINKEDIN', label: 'LinkedIn', hint: 'https://linkedin.com/in/…' },
  { value: 'FIGMA', label: 'Figma', hint: 'https://figma.com/…' },
  { value: 'ETC', label: '기타', hint: 'https://…' },
] as const;

const MAX_LINKS = 5;

interface LinkRow {
  linkType: string;
  url: string;
  memo: string;
}

interface Props {
  jobId: number;
  initialLinks: { linkType: string; url: string; memo: string | null }[];
}

function hintFor(linkType: string): string {
  return LINK_TYPE_OPTIONS.find((o) => o.value === linkType)?.hint ?? 'https://…';
}

export function PortfolioLinksSection({ jobId, initialLinks }: Props) {
  const [rows, setRows] = useState<LinkRow[]>(
    initialLinks.map((l) => ({ linkType: l.linkType, url: l.url, memo: l.memo ?? '' })),
  );
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const updateRow = (i: number, patch: Partial<LinkRow>) => {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setStatus('idle');
  };

  const addRow = () => {
    if (rows.length >= MAX_LINKS) return;
    setRows((rs) => [...rs, { linkType: 'GITHUB', url: '', memo: '' }]);
    setStatus('idle');
  };

  const removeRow = (i: number) => {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
    setStatus('idle');
  };

  const save = async () => {
    setStatus('saving');
    setErrorMsg(null);
    // 빈 URL 행은 제외하고 전송.
    const links = rows
      .filter((r) => r.url.trim() !== '')
      .map((r) => ({
        linkType: r.linkType,
        url: r.url.trim(),
        memo: r.memo.trim() === '' ? null : r.memo.trim(),
      }));
    try {
      const res = await fetch(`/api/v1/drafts/${jobId}/portfolios`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ links }),
      });
      if (!res.ok) {
        let msg = '링크를 저장하지 못했습니다. URL 형식과 허용 도메인을 확인해 주세요.';
        try {
          const body = (await res.json()) as { message?: string };
          if (typeof body.message === 'string' && body.message.trim() !== '') msg = body.message;
        } catch {
          /* 본문 파싱 실패 무시 */
        }
        setStatus('error');
        setErrorMsg(msg);
        return;
      }
      setStatus('saved');
    } catch {
      setStatus('error');
      setErrorMsg('네트워크 오류로 저장하지 못했습니다.');
    }
  };

  return (
    <fieldset className={styles.card}>
      <legend>
        포트폴리오 · 경력 링크<span className={styles.optional}>선택</span>
      </legend>
      <p className={styles.cardHint}>
        GitHub · Notion · 블로그 · LinkedIn · Figma 등 작업물/경력 링크를 최대 {MAX_LINKS}개까지
        추가할 수 있습니다.
      </p>

      <ul className={styles.linkList}>
        {rows.map((row, i) => (
          <li key={i} className={styles.linkRow}>
            <select
              aria-label={`링크 ${i + 1} 종류`}
              value={row.linkType}
              onChange={(e) => updateRow(i, { linkType: e.target.value })}
            >
              {LINK_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              type="url"
              aria-label={`링크 ${i + 1} URL`}
              placeholder={hintFor(row.linkType)}
              value={row.url}
              onChange={(e) => updateRow(i, { url: e.target.value })}
            />
            <button
              type="button"
              className={`btn-secondary ${styles.removeBtn}`}
              onClick={() => removeRow(i)}
              aria-label={`링크 ${i + 1} 삭제`}
            >
              삭제
            </button>
          </li>
        ))}
      </ul>

      <div>
        {rows.length < MAX_LINKS && (
          <button type="button" className={`btn-secondary ${styles.addBtn}`} onClick={addRow}>
            + 링크 추가
          </button>
        )}
      </div>

      <div>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void save()}
          disabled={status === 'saving'}
        >
          {status === 'saving' ? '저장 중…' : '링크 저장'}
        </button>
        {status === 'saved' && (
          <span className={styles.savedNote} role="status">
            {' '}
            저장됨
          </span>
        )}
      </div>
      {status === 'error' && errorMsg !== null && (
        <p className={styles.errorNote} role="alert">
          {errorMsg}
        </p>
      )}
    </fieldset>
  );
}
