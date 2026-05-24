/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    typedRoutes: true,
    // isomorphic-dompurify는 jsdom을 module-level evaluate → Next.js collect-page-data
    // 단계에서 default-stylesheet.css를 찾지 못해 ENOENT. server external로 빼서 우회.
    // CANDID-014 Route Handler가 sanitizeHtml을 transitively import하면서 노출됨.
    serverComponentsExternalPackages: ['isomorphic-dompurify'],
  },
};

export default nextConfig;
