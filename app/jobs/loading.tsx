// CANDID-013 Step 2 — 공고 목록 로딩 상태 (Next.js App Router 컨벤션).
// page.tsx가 dynamic = 'force-dynamic'이라 SSR 매 요청이지만, 사용자가 페이지 이동/필터 변경 시
// 짧은 spinner UX를 위한 스켈레톤.

export default function Loading() {
  return (
    <main aria-busy="true" aria-live="polite">
      <h1>채용 공고</h1>
      <p>공고를 불러오는 중입니다…</p>
      <ul>
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i}>
            <div
              aria-hidden
              style={{
                height: 88,
                background: '#eee',
                borderRadius: 8,
                marginBottom: 8,
              }}
            />
          </li>
        ))}
      </ul>
    </main>
  );
}
