// CANDID-014 Step 2 — 공고 상세 본문 (RSC).
// sanitized HTML 렌더 + 추가 질문 목록 미리보기.
// BR-JOB-04: contentHtmlSanitized는 lib/jobs/detail.ts에서 이미 sanitize 통과한 값만 도달.

import type { JobDetail, JobQuestion } from '@/lib/jobs/types';

interface Props {
  job: JobDetail;
}

function QuestionItem({ q }: { q: JobQuestion }) {
  return (
    <li>
      <span>{q.questionText}</span>
      {q.required && <span aria-label="필수">*</span>}
    </li>
  );
}

export function JobDetailBody({ job }: Props) {
  return (
    <article>
      <section aria-label="공고 본문">
        {/* contentHtmlSanitized는 lib/security/sanitize.ts 'job-posting' profile 통과한 안전한 HTML.
            저장+출력 시점 이중 sanitize 적용 (BR-JOB-04). */}
        <div dangerouslySetInnerHTML={{ __html: job.contentHtmlSanitized }} />
      </section>
      {job.questions.length > 0 && (
        <section aria-label="추가 질문">
          <h2>지원 시 답변할 질문</h2>
          <ul>
            {job.questions.map((q) => (
              <QuestionItem key={q.id} q={q} />
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
