/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    typedRoutes: true,
    // CANDID-027 Step 3: instrumentation.ts(register) 활성화 — Node 부팅 시 HTTP 메트릭 관측자 배선.
    // Next 14.2는 instrumentation 훅이 experimental opt-in(Next 15부터 기본). Edge 유입은 register 내부 가드.
    instrumentationHook: true,
    // isomorphic-dompurify는 jsdom을 module-level evaluate → Next.js collect-page-data
    // 단계에서 default-stylesheet.css를 찾지 못해 ENOENT. server external로 빼서 우회.
    // CANDID-014 Route Handler가 sanitizeHtml을 transitively import하면서 노출됨.
    serverComponentsExternalPackages: ['isomorphic-dompurify'],
  },
};

export default nextConfig;
