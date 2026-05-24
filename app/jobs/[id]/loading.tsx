// CANDID-014 Step 2 — 공고 상세 페이지 suspense fallback.

export default function JobDetailLoading() {
  return (
    <main aria-busy="true" aria-live="polite">
      <p>공고 정보를 불러오는 중입니다…</p>
    </main>
  );
}
