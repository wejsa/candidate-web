'use client';

// CANDID-053 Step 10 — 공고 생성/수정 공용 폼(Client).
//   create: POST /api/admin/v1/job-postings (항상 DRAFT 생성) / edit: PATCH /{id}.
//   contentHtml은 서버에서 sanitizeHtml로 정화(저장+출력 이중 방어) — 클라이언트는 원문 전송.
//   상태 전이는 본 폼이 아니라 목록의 StatusControl이 담당(관심사 분리).
//   에러 분기는 HTTP status가 아닌 응답 code 기반(서버 ERROR_CATALOG가 SSOT).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CareerLevel, EmploymentType } from '@prisma/client';
import { CAREER_LABEL, EMPLOYMENT_LABEL } from '@/lib/jobs/labels';
import styles from '../job-postings.module.css';
import type { JobCategoryOption } from '@/lib/admin/job-postings-list';

export interface JobPostingFormInitial {
  id: number;
  title: string;
  jobCategoryId: number;
  employmentType: EmploymentType;
  careerLevel: CareerLevel;
  contentHtml: string;
  opensAtLocal: string;
  closesAtLocal: string;
}

interface Props {
  mode: 'create' | 'edit';
  categories: JobCategoryOption[];
  initial?: JobPostingFormInitial;
}

interface SubmitState {
  status: 'idle' | 'pending' | 'error';
  message: string | null;
}

// 서버 contentHtml 검증과 정합되는 클라 상한(거대 payload 선차단 — 보안/UX).
const CONTENT_MAX = 20_000;

function messageForCode(httpStatus: number, code: unknown): string {
  if (code === 'AUTH_FORBIDDEN') return '권한이 없습니다.';
  if (code === 'JOB_NOT_FOUND') return '공고를 찾을 수 없습니다.';
  if (code === 'SYS_VALIDATION_FAILED' || httpStatus === 400) return '입력값을 다시 확인해 주세요.';
  return '잠시 후 다시 시도해 주세요.';
}

/** datetime-local("YYYY-MM-DDTHH:mm") → ISO. 입력값을 UTC로 해석(프리필도 UTC).
 *  운영자 브라우저 타임존에 따라 저장값이 달라지는 모호성을 제거 — 입력 라벨에 (UTC) 명시. */
function toIso(local: string): string | null {
  if (local === '') return null;
  return new Date(`${local}:00Z`).toISOString();
}

export function JobPostingForm({ mode, categories, initial }: Props): React.JSX.Element {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [jobCategoryId, setJobCategoryId] = useState<number>(
    initial?.jobCategoryId ?? categories[0]?.id ?? 0,
  );
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    initial?.employmentType ?? EmploymentType.FULL_TIME,
  );
  const [careerLevel, setCareerLevel] = useState<CareerLevel>(initial?.careerLevel ?? CareerLevel.ANY);
  const [contentHtml, setContentHtml] = useState(initial?.contentHtml ?? '');
  const [opensAt, setOpensAt] = useState(initial?.opensAtLocal ?? '');
  const [closesAt, setClosesAt] = useState(initial?.closesAtLocal ?? '');
  const [state, setState] = useState<SubmitState>({ status: 'idle', message: null });

  async function submit(): Promise<void> {
    setState({ status: 'pending', message: null });
    const opensIso = toIso(opensAt);
    if (opensIso === null) {
      setState({ status: 'error', message: '시작일시를 입력해 주세요.' });
      return;
    }
    const closesIso = toIso(closesAt); // null = 상시 모집
    // 서버 refine(closesAt>opensAt)와 동일 규칙을 클라에서도 선검증 — 어느 필드 문제인지 즉시 안내.
    if (closesIso !== null && new Date(closesIso).getTime() <= new Date(opensIso).getTime()) {
      setState({ status: 'error', message: '마감일시는 시작일시보다 이후여야 합니다.' });
      return;
    }
    const body = {
      title: title.trim(),
      jobCategoryId,
      employmentType,
      careerLevel,
      contentHtml,
      opensAt: opensIso,
      closesAt: closesIso,
    };
    const url =
      mode === 'create'
        ? '/api/admin/v1/job-postings'
        : `/api/admin/v1/job-postings/${initial!.id}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      setState({ status: 'error', message: '네트워크 오류입니다. 잠시 후 다시 시도해 주세요.' });
      return;
    }
    if (res.ok) {
      router.push('/admin/job-postings');
      router.refresh();
      return;
    }
    let code: unknown;
    try {
      code = ((await res.json()) as { code?: unknown }).code;
    } catch {
      /* 본문 없음 */
    }
    setState({ status: 'error', message: messageForCode(res.status, code) });
  }

  const isPending = state.status === 'pending';

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() === '' || contentHtml.trim() === '') {
          setState({ status: 'error', message: '제목과 본문을 입력해 주세요.' });
          return;
        }
        void submit();
      }}
    >
      <label className={styles.field}>
        제목
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          disabled={isPending}
        />
      </label>

      <label className={styles.field}>
        직군
        <select
          value={jobCategoryId}
          onChange={(e) => setJobCategoryId(Number(e.target.value))}
          disabled={isPending}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.row}>
        <label className={styles.field}>
          고용형태
          <select
            value={employmentType}
            onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
            disabled={isPending}
          >
            {Object.values(EmploymentType).map((t) => (
              <option key={t} value={t}>
                {EMPLOYMENT_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          경력
          <select
            value={careerLevel}
            onChange={(e) => setCareerLevel(e.target.value as CareerLevel)}
            disabled={isPending}
          >
            {Object.values(CareerLevel).map((c) => (
              <option key={c} value={c}>
                {CAREER_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.row}>
        <label className={styles.field}>
          시작일시 <span className={styles.hint}>(UTC)</span>
          <input
            type="datetime-local"
            value={opensAt}
            onChange={(e) => setOpensAt(e.target.value)}
            required
            disabled={isPending}
          />
        </label>
        <label className={styles.field}>
          마감일시 <span className={styles.hint}>(UTC, 비우면 상시)</span>
          <input
            type="datetime-local"
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
            disabled={isPending}
          />
        </label>
      </div>

      <label className={styles.field}>
        본문(HTML)
        <textarea
          value={contentHtml}
          onChange={(e) => setContentHtml(e.target.value)}
          rows={10}
          maxLength={CONTENT_MAX}
          required
          disabled={isPending}
        />
      </label>

      {state.status === 'error' && state.message !== null && (
        <p role="alert" className={styles.error}>
          {state.message}
        </p>
      )}

      <button type="submit" className={styles.primaryBtn} disabled={isPending}>
        {isPending ? '저장 중…' : mode === 'create' ? '공고 생성(임시저장)' : '변경 저장'}
      </button>
    </form>
  );
}
