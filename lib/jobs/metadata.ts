// CANDID-013 Step 2 — 공고 목록 페이지 메타데이터 생성 (US-JOB-001 SEO).
// Acceptance Criteria "메타 태그(title/description/OG) 동적 생성" 충족.
// page.tsx의 generateMetadata에서 호출 — 순수 함수로 분리해 unit 테스트 가능.

import type { Metadata } from 'next';
import type { ParsedJobListQuery } from '@/lib/jobs/list';
import { CAREER_LABEL, EMPLOYMENT_LABEL } from '@/lib/jobs/labels';

const SORT_LABEL: Record<ParsedJobListQuery['sort'], string> = {
  latest: '최신순',
  deadline: '마감임박순',
};

export interface JobsListMetadataInput {
  query: ParsedJobListQuery;
  total: number;
  // jobCategory.slug 매칭된 사람 친화 카테고리명 (선택). 미제공 시 slug 그대로 사용.
  categoryName?: string;
}

export function buildJobsListMetadata({
  query,
  total,
  categoryName,
}: JobsListMetadataInput): Metadata {
  const filterLabels: string[] = [];
  if (categoryName) filterLabels.push(categoryName);
  else if (query.category) filterLabels.push(query.category);
  if (query.employment) filterLabels.push(EMPLOYMENT_LABEL[query.employment]);
  if (query.career) filterLabels.push(CAREER_LABEL[query.career]);

  const filterText = filterLabels.length > 0 ? filterLabels.join(' · ') : '전체';
  const sortText = SORT_LABEL[query.sort];
  const totalText = total > 0 ? `${total.toLocaleString('ko-KR')}건` : '';

  const title = filterLabels.length > 0 ? `${filterLabels.join(' / ')} 채용 공고` : '채용 공고';
  const description = totalText
    ? `${filterText} 채용 공고 ${totalText}. ${sortText} 정렬.`
    : `${filterText} 채용 공고 목록. ${sortText} 정렬.`;

  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary', title, description },
    alternates: { canonical: buildCanonicalPath(query) },
    robots: { index: true, follow: true },
  };
}

// page=1 + 기본값(latest)은 canonical에서 제외 — 중복 콘텐츠 방지 (SEO).
export function buildCanonicalPath(q: ParsedJobListQuery): string {
  const params = new URLSearchParams();
  if (q.category) params.set('category', q.category);
  if (q.employment) params.set('employment', q.employment);
  if (q.career) params.set('career', q.career);
  if (q.sort !== 'latest') params.set('sort', q.sort);
  // includeClosed 기본값(true)은 canonical에서 생략 (개시 URL이 SEO 정규형).
  if (q.includeClosed === false) params.set('includeClosed', 'false');
  if (q.page > 1) params.set('page', String(q.page));
  const qs = params.toString();
  return qs ? `/jobs?${qs}` : '/jobs';
}
