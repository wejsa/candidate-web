import type { MetadataRoute } from 'next';

// CANDID-025 Step 2 — robots.txt. 공고/공개 페이지는 색인 허용, 인증 영역(/me)·API는 차단.
const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // 마이페이지(개인 데이터)·API는 색인 대상이 아니다.
      disallow: ['/me', '/api'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
