import 'server-only';
import { VirusScanStatus } from '@prisma/client';
import { basePrisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import {
  assertResumeContentType,
  assertResumeFileSize,
  type PresignRequest,
} from '@/lib/files/validation';
import {
  deleteResumeObject,
  presignResumeUpload,
  type PresignedPutResult,
} from '@/lib/files/storage';

// CANDID-016 Step 2 — issueResumePresign 비즈니스 (US-APP-003 + BR-FILE-01~05).
//
// 호출 흐름: Route Handler → requireAuth → 본 함수.
// 책임:
//   1. 입력 검증 (확장자/MIME/크기 화이트리스트)
//   2. draft 소유권 검증 (다른 사용자 draft에 첨부 차단)
//   3. 기존 활성 첨부 row 정리 — D-MAJOR-2 fix 정합: virus_scan_status IN ('PENDING','CLEAN')만 정리.
//      INFECTED/FAILED row는 audit 추적 위해 보존 (partial UNIQUE 평가 외).
//   4. S3 presigned URL 발급 + 응답 반환.
//
// 트랜잭션 경계: D-MAJOR-2 fix (PR #58 in-PR) 주석 정정 — $transaction은 활성 row 조회/삭제 윈도우만
// 좁힌다. 트랜잭션 커밋 후 ~ presign/confirm 도착 사이에 다른 탭 confirm이 끼어들 수 있으나,
// **DB partial UNIQUE(uk_resume_files_one_per_draft)가 최종 방어선**이라 데이터 정합성은 보장.
// 늦은 confirm은 P2002 → 409 FILE_ALREADY_EXISTS로 사용자에게 안내(교체 후 재시도).
// S3 객체 정리는 *트랜잭션 외부* fire-and-forget (BR-TX-02). 실패는 audit 로그로 분류
// (본 task는 최소 구현 — 본격 정리는 CANDID-029 야간 배치 위임).

export interface IssueResumePresignParams {
  userId: number;
  request: PresignRequest;
}

export interface IssueResumePresignResult extends PresignedPutResult {
  /** 교체로 삭제 큐에 들어간 기존 storedPath 목록 — Step 3 UI 디버깅용 */
  replacedPaths: string[];
}

export async function issueResumePresign(
  params: IssueResumePresignParams,
): Promise<IssueResumePresignResult> {
  const { userId, request } = params;

  // 1. 검증 (확장자/MIME/크기) — 위반 시 422 throw.
  assertResumeContentType(request.originalFilename, request.contentType);
  assertResumeFileSize(request.fileSize);

  // 2. draft 소유권 — userId 불일치 또는 미존재 → 403.
  //    의도적으로 404와 403을 통합 (정보 노출 최소화 — 다른 사용자 draft 존재 추측 차단).
  const draft = await basePrisma.applicationDraft.findUnique({
    where: { id: request.draftId },
    select: { id: true, userId: true },
  });
  if (draft === null || draft.userId !== userId) {
    throw new AppError('AUTH_FORBIDDEN', { message: '해당 draft에 접근할 수 없습니다.' });
  }

  // 3. 기존 활성 첨부 정리 — 트랜잭션 내 단일 SELECT + DELETE.
  //    partial UNIQUE는 PENDING/CLEAN만 평가하므로 동일 조건으로 deleteMany.
  //    트랜잭션은 race 윈도우를 좁힐 뿐 (D-MAJOR-2 정정), DB partial UNIQUE가 최종 방어선.
  const replacedPaths = await basePrisma.$transaction(async (tx) => {
    const active = await tx.resumeFile.findMany({
      where: {
        draftId: request.draftId,
        virusScanStatus: { in: [VirusScanStatus.PENDING, VirusScanStatus.CLEAN] },
      },
      select: { id: true, storedPath: true },
    });
    if (active.length > 0) {
      await tx.resumeFile.deleteMany({
        where: { id: { in: active.map((r) => r.id) } },
      });
    }
    return active.map((r) => r.storedPath);
  });

  // 4. presigned URL 발급. SDK 오류는 storage.ts가 FILE_UPLOAD_FAILED로 정규화.
  const presigned = await presignResumeUpload(request.originalFilename, request.contentType);

  // 5. fire-and-forget S3 객체 삭제. 실패는 무시 — CANDID-029가 orphan 청소.
  //    동기 await하면 presign 응답 지연 + 사용자 경험 저하.
  for (const storedPath of replacedPaths) {
    void deleteResumeObject(storedPath).catch(() => {
      // silent — orphan 정리는 CANDID-029 위임.
    });
  }

  return { ...presigned, replacedPaths };
}

// A-MAJOR-1 fix (PR #58 in-PR): isPrismaUniqueViolation을 `@/lib/files/prisma-errors`로 이관 (순환 import 방지).
