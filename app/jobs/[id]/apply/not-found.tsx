// CANDID-015 Step 3 — 지원서 작성 페이지 404.
// DRAFT/미존재/마감 공고 모두 동일 메시지 (ID enumeration 차단).

import Link from 'next/link';

export default function ApplyNotFound() {
  return (
    <main>
      <h1>지원서를 시작할 수 없습니다</h1>
      <p>요청하신 공고에 지원할 수 없습니다.</p>
      <p>
        <Link href="/jobs">채용 공고 목록으로 돌아가기</Link>
      </p>
    </main>
  );
}
