// CANDID-025 Step 1 — 공고 상세 JobPosting structured data (schema.org JSON-LD).
// CANDID-014 detail-metadata.ts가 위임한 영역("JobPosting structured data는 CANDID-025 위임").
// 순수 함수로 분리해 unit 테스트 가능 — page.tsx의 RSC가 <script type="application/ld+json">로 주입.

import type { JobDetail } from '@/lib/jobs/types';
import { htmlToPlainText } from '@/lib/jobs/detail-metadata';

// Prisma EmploymentType → schema.org JobPosting.employmentType enum 매핑.
// schema.org 허용값: FULL_TIME | PART_TIME | CONTRACTOR | TEMPORARY | INTERN | ...
const EMPLOYMENT_TYPE_SCHEMA: Record<JobDetail['employmentType'], string> = {
  FULL_TIME: 'FULL_TIME',
  CONTRACT: 'CONTRACTOR',
  INTERN: 'INTERN',
};

// 채용 주체 — 단일 자사 사이트이므로 상수. (조직명이 환경별로 달라지면 env로 이관)
const ORG_NAME = '자사 채용';
// JSON-LD description은 메타 description(160자)보다 길게 허용 — 검색엔진 본문 설명용.
const JSONLD_DESCRIPTION_MAX = 5000;

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

/**
 * 공고 상세를 schema.org `JobPosting` JSON-LD 객체로 변환한다.
 * 마감 공고도 SEO 자산으로 유지하므로 validThrough가 과거여도 그대로 노출한다(BR-JOB-02).
 * 근무지 컬럼이 없어 `jobLocationType: TELECOMMUTE` + 국내(KR) 지원 요건으로 최소 유효 마크업을 구성한다.
 */
export function buildJobPostingJsonLd(job: JobDetail, baseUrl: string): Record<string, unknown> {
  const base = stripTrailingSlash(baseUrl);
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    'title': job.title,
    'description': htmlToPlainText(job.contentHtmlSanitized, JSONLD_DESCRIPTION_MAX) || job.title,
    'datePosted': job.opensAt.toISOString(),
    'employmentType': EMPLOYMENT_TYPE_SCHEMA[job.employmentType],
    'hiringOrganization': { '@type': 'Organization', 'name': ORG_NAME, 'sameAs': base },
    'jobLocationType': 'TELECOMMUTE',
    'applicantLocationRequirements': { '@type': 'Country', 'name': 'KR' },
    'identifier': { '@type': 'PropertyValue', 'name': ORG_NAME, 'value': job.id },
    'url': `${base}/jobs/${job.id}`,
    'directApply': true,
  };
  // 상시모집(closesAt=null)은 validThrough 생략 — 무기한 유효.
  if (job.closesAt !== null) {
    jsonLd.validThrough = job.closesAt.toISOString();
  }
  return jsonLd;
}

/**
 * JSON-LD 객체를 `<script type="application/ld+json">` 본문에 안전하게 주입할 문자열로 직렬화한다.
 * `<`를 `<`로 치환해 `</script>`·`<!--` 브레이크아웃(XSS)을 차단한다 — 출력 시점 방어(BR-SEC-05).
 * 입력(title/category)이 sanitize되지 않은 `<`를 포함해도 안전하다.
 */
export function jsonLdScriptContent(jsonLd: Record<string, unknown>): string {
  return JSON.stringify(jsonLd).replace(/</g, '\\u003c');
}
