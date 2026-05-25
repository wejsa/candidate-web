import 'server-only';
import type { VirusScanStatus } from '@prisma/client';
import { basePrisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import {
  assertResumeContentType,
  assertResumeFileSize,
  type ConfirmRequest,
} from '@/lib/files/validation';
import { isValidResumeStoredPath } from '@/lib/files/storage';
// A-MAJOR-1 + D-MAJOR-1 + S-MAJOR-1 fix (PR #58 in-PR): isResumeActiveUniqueViolation으로 교체.
// 순환 import 해소(resume → confirm 의존성 제거) + P2002 target 검증으로 무차별 매핑 차단.
import { isResumeActiveUniqueViolation } from '@/lib/files/prisma-errors';

// CANDID-016 Step 2 — confirmResumeUpload 비즈니스.
//
// 호출 흐름: 클라이언트가 S3 PUT 성공 → POST /confirm → Route Handler → requireAuth → 본 함수.
// 책임:
//   1. 입력 검증 (validation 재실행 — 클라이언트 위변조 차단)
//   2. storedPath 형식 검증 — presign이 만든 키 prefix와 정합 (외부 prefix 주입 차단)
//   3. draft 소유권 검증
//   4. ResumeFile.create — partial UNIQUE 충돌 시 409 FILE_ALREADY_EXISTS 매핑
//
// 트랜잭션 경계: create 단일 호출. partial UNIQUE는 DB가 강제 (D-MAJOR-2 fix 반영: PENDING/CLEAN만 평가).

export interface ConfirmResumeParams {
  userId: number;
  request: ConfirmRequest;
}

export interface ConfirmResumeResult {
  id: number;
  virusScanStatus: VirusScanStatus;
  uploadedAt: Date;
}

export async function confirmResumeUpload(params: ConfirmResumeParams): Promise<ConfirmResumeResult> {
  const { userId, request } = params;

  // 1. 검증 재실행 — confirm 호출 시 presign 단계 검증을 우회한 위변조 차단.
  assertResumeContentType(request.originalFilename, request.contentType);
  assertResumeFileSize(request.fileSize);

  // 2. storedPath 위변조 가드 — presign이 발급한 키 형식만 통과.
  if (!isValidResumeStoredPath(request.storedPath)) {
    throw new AppError('SYS_VALIDATION_FAILED', { message: 'storedPath 형식이 올바르지 않습니다.' });
  }

  // 3. draft 소유권. 403 통합 (정보 노출 최소화).
  const draft = await basePrisma.applicationDraft.findUnique({
    where: { id: request.draftId },
    select: { id: true, userId: true },
  });
  if (draft === null || draft.userId !== userId) {
    throw new AppError('AUTH_FORBIDDEN', { message: '해당 draft에 접근할 수 없습니다.' });
  }

  // 4. ResumeFile.create. partial UNIQUE 위반(P2002) → 409 매핑.
  //    BR-FILE-04 정합: virus_scan_status는 DB default PENDING.
  try {
    const created = await basePrisma.resumeFile.create({
      data: {
        ownerUserId: userId,
        draftId: request.draftId,
        // applicationId는 NULL — draft → submit 전이 시 BR-TX-01 단일 트랜잭션으로 이관.
        originalFilename: request.originalFilename,
        storedPath: request.storedPath,
        contentType: request.contentType,
        fileSize: BigInt(request.fileSize),
        checksumSha256: request.checksumSha256,
        // virusScanStatus는 schema default PENDING. CANDID-029 워커가 PENDING row 처리.
      },
      select: { id: true, virusScanStatus: true, uploadedAt: true },
    });
    return created;
  } catch (err) {
    // D-MAJOR-1/S-MAJOR-1 fix: target 검증된 헬퍼만 매핑. 다른 UNIQUE 충돌은 그대로 전파.
    if (isResumeActiveUniqueViolation(err)) {
      // partial UNIQUE — 동시 탭 race. 호출자에게 안내 (409 → 사용자 재시도).
      throw new AppError('FILE_ALREADY_EXISTS', {
        message: '이미 첨부된 파일이 있습니다. 기존 파일 교체 후 다시 시도해 주세요.',
      });
    }
    throw err;
  }
}
