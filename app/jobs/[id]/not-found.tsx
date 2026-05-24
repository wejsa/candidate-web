// CANDID-014 Step 2 — 공고 상세 404. DRAFT/미존재 모두 동일 응답 (정보 노출 차단).

import Link from 'next/link';

export default function JobDetailNotFound() {
  return (
    <main>
      <h1>공고를 찾을 수 없습니다</h1>
      <p>요청하신 채용 공고가 존재하지 않거나 비공개 상태입니다.</p>
      <p>
        <Link href="/jobs">채용 공고 목록으로 돌아가기</Link>
      </p>
    </main>
  );
}
