// CANDID-014 Step 2 — 공고 상세 페이지 메타데이터 생성 (US-JOB-002 SEO).
// page.tsx의 generateMetadata에서 호출. 순수 함수로 분리해 unit 테스트 가능.
// JobPosting structured data(schema.org)는 CANDID-025 위임 — 본 모듈은 OG/title만.

import type { Metadata } from 'next';
import type { JobDetail } from '@/lib/jobs/types';
import { CAREER_LABEL, EMPLOYMENT_LABEL } from '@/lib/jobs/labels';

const DESCRIPTION_MAX_CHARS = 160;
const SITE_NAME = '채용 공고';

/**
 * HTML 태그 strip + 공백 정규화 후 maxLen 까지 truncate.
 * sanitize는 이미 적용된 입력 가정 (`JobDetail.contentHtmlSanitized`).
 * 정규식 strip은 OG description용 의도 — 본문 표시에는 사용 금지.
 */
export function htmlToPlainText(html: string, maxLen = DESCRIPTION_MAX_CHARS): string {
  // sanitize 후라 <script> 등은 이미 제거됨 — 안전한 태그 strip
  const stripped = html.replace(/<[^>]*>/g, ' ');
  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLen) return collapsed;
  // 단어 경계로 자르되, 한국어처럼 공백 없는 텍스트는 글자 단위로 자름
  return `${collapsed.slice(0, maxLen).trimEnd()}…`;
}

export function buildJobDetailMetadata(job: JobDetail): Metadata {
  const employmentText = EMPLOYMENT_LABEL[job.employmentType];
  const careerText = CAREER_LABEL[job.careerLevel];
  const title = `${job.title} | ${SITE_NAME}`;
  const description = htmlToPlainText(job.contentHtmlSanitized) || `${job.category.name} / ${employmentText} / ${careerText}`;
  const canonical = `/jobs/${job.id}`;

  return {
    title,
    description,
    // 마감 공고도 SEO 자산으로 유지 (CANDID-025와 정합) — robots.index는 항상 true.
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      type: 'article',
      url: canonical,
    },
    twitter: { card: 'summary', title, description },
    alternates: { canonical },
  };
}
