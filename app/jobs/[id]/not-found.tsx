// CANDID-014 Step 2 — 공고 상세 404. DRAFT/미존재 모두 동일 응답 (정보 노출 차단).

import Link from 'next/link';

export default function JobDetailNotFound() {
  // CANDID-014 Step 3 L-019 (S-MINOR-1): DRAFT/미존재 모두 동일 메시지 — '비공개 상태' 단서 제거로
  // ID enumeration 신호 차단. page.tsx 서비스 레이어가 두 케이스를 동일하게 throw하는 의도와 일치.
  return (
    <main>
      <h1>공고를 찾을 수 없습니다</h1>
      <p>요청하신 채용 공고를 찾을 수 없습니다.</p>
      <p>
        <Link href="/jobs">채용 공고 목록으로 돌아가기</Link>
      </p>
    </main>
  );
}
