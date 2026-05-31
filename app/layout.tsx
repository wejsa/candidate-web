import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

const SITE_NAME = 'candidate-web';

// CANDID-025 — metadataBase로 하위 페이지의 상대 canonical/OG URL을 절대 URL로 승격(SEO).
// 루트 layout metadata는 `next build`의 정적 페이지 데이터 수집 단계에서 평가되므로 getEnv()
// (서버 시크릿 포함 전체 zod 검증)를 호출하면 빌드 환경에서 실패한다 → 빌드-인라인되는 공개 변수
// NEXT_PUBLIC_APP_URL을 직접 사용한다(env.ts의 기본값과 동일). 기본 openGraph는 페이지가 덮어쓴다.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: '자사 채용 사이트 지원자 프론트엔드',
  robots: { index: true, follow: true },
  openGraph: { siteName: SITE_NAME, locale: 'ko_KR', type: 'website' },
  twitter: { card: 'summary' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
