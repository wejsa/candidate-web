// CANDID-050 Step 1 — JobCard 링크 범위 회귀 테스트 (RTL, jsdom).
// 검증(P1): 카드의 네비게이션 링크는 **제목 1개**뿐이고, 직군/고용형태/경력·D-Day 메타는
//   링크가 아니다(전역 `a` 색 상속으로 "전부 하이퍼링크"처럼 보이던 결함 방지).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { JobCard } from '@/app/jobs/_components/JobCard';
import type { JobListItem } from '@/lib/jobs/types';

const job: JobListItem = {
  id: 7,
  title: '프론트엔드 엔지니어',
  employmentType: 'FULL_TIME',
  careerLevel: 'EXPERIENCED',
  category: { name: '개발', slug: 'dev' },
  opensAt: new Date('2026-05-01T00:00:00Z'),
  closesAt: new Date('2026-07-01T00:00:00Z'),
  dDayLabel: 'D-29',
};

afterEach(() => {
  cleanup();
});

describe('JobCard 링크 범위', () => {
  it('네비게이션 링크는 제목 1개뿐이고 /jobs/{id}로 이동한다', () => {
    render(<JobCard job={job} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName('프론트엔드 엔지니어');
    expect(links[0]).toHaveAttribute('href', '/jobs/7');
  });

  it('직군/고용형태/경력 메타는 링크가 아니다(링크 색 상속 차단)', () => {
    const { container } = render(<JobCard job={job} />);
    // dd(값) 셀을 직접 타깃 — "경력" 라벨(dt)과의 텍스트 충돌 회피.
    const values = Array.from(container.querySelectorAll('dd'));
    expect(values.map((d) => d.textContent)).toEqual(['개발', '정규직', '경력']);
    for (const dd of values) {
      expect(dd.closest('a')).toBeNull();
    }
  });

  it('D-Day 라벨을 노출한다', () => {
    render(<JobCard job={job} />);
    expect(screen.getByText('D-29')).toBeInTheDocument();
  });

  it('dDayLabel이 null이면 마감일 span을 렌더하지 않는다(상시모집/마감 공고 경로)', () => {
    const { container } = render(<JobCard job={{ ...job, dDayLabel: null }} />);
    expect(container.querySelector('[aria-label="마감일"]')).toBeNull();
  });

  it('마감 카드 — 제목 링크는 유지하고 마감 뱃지를 노출한다', () => {
    const { container } = render(<JobCard job={job} closed />);
    const article = container.querySelector('article');
    expect(article).toHaveAttribute('data-closed', 'true');
    // 마감이어도 SEO/접근성 위해 제목 링크는 유지.
    expect(screen.getAllByRole('link')).toHaveLength(1);
    const region = within(article as HTMLElement);
    expect(region.getByText('마감')).toBeInTheDocument();
  });
});
