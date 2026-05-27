// CANDID-019 Step 3 — 마이페이지 로딩 상태 (Next.js loading.tsx convention).

export default function Loading() {
  return (
    <main aria-busy="true" aria-live="polite">
      <p>지원 내역을 불러오는 중입니다…</p>
    </main>
  );
}
