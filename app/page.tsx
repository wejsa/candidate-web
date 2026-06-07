// P1-1 — 홈 랜딩 (RSC). 기존 셋업 검증용 플레이스홀더를 교체.
// 정적 콘텐츠만 사용(DB 비의존) → 기본 SSG. 카피/직군은 예시값으로, 운영 시 교체 대상.
import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: '엔지니어 채용',
  description:
    'Hoji는 무인 환전·결제 플랫폼을 설계하고 운영합니다. 미션 크리티컬 금융 시스템을 함께 만들 엔지니어를 찾습니다.',
  openGraph: {
    title: 'Hoji 엔지니어 채용',
    description: '무인 환전·결제 플랫폼을 함께 만들 엔지니어를 찾습니다.',
    type: 'website',
  },
};

const VALUES = [
  {
    title: '직접 만드는 금융 인프라',
    desc: '무인 환전·결제 키오스크부터 정산 백엔드까지, 사용자 손에 닿는 금융 흐름 전체를 설계하고 운영합니다.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3 2 8l10 5 10-5-10-5Z" />
        <path d="M2 16l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    title: '미션 크리티컬한 신뢰성',
    desc: '99.9%를 향한 고가용성 아키텍처와 관측 가능성(모니터링·알림)을 기본값으로 삼습니다. 장애는 설계로 막습니다.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    title: '함께 성장하는 팀',
    desc: '명확한 코드 컨벤션과 리뷰 문화, 학습을 가속하는 베이스 템플릿. 혼자 잘하기보다 팀으로 더 멀리 갑니다.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" />
      </svg>
    ),
  },
];

const STEPS = [
  { label: '서류 전형', desc: '지원서·포트폴리오 검토' },
  { label: '1차 면접', desc: '기술 역량 중심' },
  { label: '2차 면접', desc: '협업·컬처 핏' },
  { label: '처우 협의', desc: '조건 조율' },
  { label: '입사', desc: '온보딩 시작' },
];

export default function HomePage() {
  return (
    <main id="main-content" className={styles.home}>
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>HOJI ENGINEERING</p>
          <h1 className={styles.title}>함께 금융을 움직일 엔지니어를 찾습니다</h1>
          <p className={styles.subtitle}>
            무인 환전·결제 플랫폼을 직접 설계하고 운영하세요. Spring Boot부터 Next.js까지, 미션 크리티컬한
            시스템을 함께 만들 동료를 기다립니다.
          </p>
          <div className={styles.actions}>
            <Link href="/jobs" className={styles.btnPrimary}>
              채용 공고 보기
            </Link>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionAlt}`} aria-labelledby="values-title">
        <div className={styles.inner}>
          <div className={styles.sectionHead}>
            <h2 id="values-title" className={styles.sectionTitle}>
              우리가 일하는 방식
            </h2>
            <p className={styles.sectionLead}>
              기술로 신뢰를 만드는 팀. 우리가 중요하게 여기는 세 가지입니다.
            </p>
          </div>
          <ul className={styles.cards}>
            {VALUES.map((v) => (
              <li key={v.title} className={styles.card}>
                <span className={styles.cardIcon}>{v.icon}</span>
                <h3 className={styles.cardTitle}>{v.title}</h3>
                <p className={styles.cardDesc}>{v.desc}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="process-title">
        <div className={styles.inner}>
          <div className={styles.sectionHead}>
            <h2 id="process-title" className={styles.sectionTitle}>
              채용 절차
            </h2>
            <p className={styles.sectionLead}>
              지원부터 입사까지, 보통 2~3주가 소요됩니다. 일정은 상황에 따라 조율됩니다.
            </p>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((s, i) => (
              <li key={s.label} className={styles.step}>
                <span className={styles.stepNum}>{i + 1}</span>
                <p className={styles.stepLabel}>{s.label}</p>
                <p className={styles.stepDesc}>{s.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={styles.inner} aria-labelledby="cta-title">
        <div className={styles.cta}>
          <h2 id="cta-title" className={styles.ctaTitle}>
            지금, 함께 시작하세요
          </h2>
          <p className={styles.ctaLead}>열려 있는 포지션을 확인하고 지원해 보세요.</p>
          <Link href="/jobs" className={styles.ctaBtn}>
            채용 공고 보러 가기
          </Link>
        </div>
      </section>
    </main>
  );
}
