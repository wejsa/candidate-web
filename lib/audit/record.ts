import 'server-only';
import { Prisma } from '@prisma/client';
import type { AuditEventType } from '@prisma/client';
import { basePrisma } from '@/lib/prisma';
import { getTraceId } from '@/lib/observability/trace-context';

// CANDID-026 Step 2 — 감사 로그 emit SSOT.
// audit_logs INSERT의 단일 진입점. 4개 모듈이 인라인 반복하던 auditLog.create를 본 헬퍼로 통일한다.
//   - traceId: ALS 컨텍스트(getTraceId, CANDID-026 Step 1)에서 자동 첨부 — 호출측 인자 불필요.
//   - metadata: PII-free 가드(assertPiiFreeMetadata)로 평문 PII/토큰 유입을 차단(BR-PII-01/02).
//   - ipAddress는 전용 컬럼으로만 — metadata 중복 금지(정규화).
// audit_logs는 PII 컬럼이 없어 복호화 extension이 불필요하므로 basePrisma를 기본 클라이언트로 쓴다.
// BR-TX-01: 트랜잭션 내부 호출은 options.tx로 같은 트랜잭션에서 기록한다.

/** 감사 metadata에 평문 PII/토큰이 유입되면 throw — fail-closed 회귀 가드(BR-PII-01/02). */
export class AuditMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditMetadataError';
  }
}

// metadata 키 화이트리스트가 아닌 블랙리스트 — PII로 해석될 수 있는 키 이름을 차단한다.
const FORBIDDEN_METADATA_KEYS = new Set([
  'email',
  'phone',
  'password',
  'passwd',
  'secret',
  'token',
  'jwt',
  'ssn',
  'birth',
  'birthdate',
  'birth_date',
  'address',
  'name',
  'fullname',
]);

// 값 자체가 PII로 보이는 패턴 — 이메일(@), 전화번호 형태.
const PII_VALUE_PATTERNS: readonly RegExp[] = [
  /@/,
  /\b\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/,
];

const MAX_METADATA_VALUE_LENGTH = 256;

/**
 * metadata가 PII-free인지 검증한다. 위반 시 AuditMetadataError throw(fail-closed).
 * - 금지 키(email/phone/token/name/birth 등) 차단
 * - 문자열 값이 이메일/전화 패턴이거나 과도하게 길면 차단(평문 PII·토큰 유입 방지)
 */
export function assertPiiFreeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (metadata === undefined) return undefined;
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())) {
      throw new AuditMetadataError(`audit metadata에 금지 키 포함: "${key}"`);
    }
    if (typeof value === 'string') {
      if (value.length > MAX_METADATA_VALUE_LENGTH) {
        throw new AuditMetadataError(`audit metadata 값이 너무 김: "${key}" (>${MAX_METADATA_VALUE_LENGTH})`);
      }
      for (const pattern of PII_VALUE_PATTERNS) {
        if (pattern.test(value)) {
          throw new AuditMetadataError(`audit metadata 값이 PII 패턴과 일치: "${key}"`);
        }
      }
    }
  }
  return metadata;
}

export interface RecordAuditInput {
  eventType: AuditEventType;
  actorUserId?: number | null;
  resourceType?: string | null;
  resourceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** PII-free 키만 — assertPiiFreeMetadata 가드로 강제. */
  metadata?: Record<string, unknown>;
}

// 본 헬퍼는 auditLog.create만 호출한다. Prisma의 PII extension 제네릭(InternalArgs)이 모든 델리게이트
// 타입에 전파되어 base/extended 트랜잭션 클라이언트가 서로 비대입(non-assignable)이므로, Prisma 델리게이트
// 타입에 의존하지 않는 최소 구조적 인터페이스로 받는다 — base prisma·base tx·PII-extended tx 모두 수용.
interface AuditLogWriteClient {
  auditLog: {
    create: (args: { data: Prisma.AuditLogUncheckedCreateInput }) => Promise<unknown>;
  };
}

export interface RecordAuditOptions {
  /** 트랜잭션 내부 호출 시 tx client 전달 — 같은 트랜잭션에서 기록(BR-TX-01). */
  tx?: AuditLogWriteClient;
}

/**
 * audit_logs에 1행을 기록한다(감사 emit SSOT).
 * traceId는 ALS 컨텍스트에서 자동 첨부되고, metadata는 PII-free 가드를 통과한 값만 저장된다.
 */
export async function recordAuditEvent(
  input: RecordAuditInput,
  options: RecordAuditOptions = {},
): Promise<void> {
  const client: AuditLogWriteClient = options.tx ?? basePrisma;
  const metadata = assertPiiFreeMetadata(input.metadata);
  await client.auditLog.create({
    data: {
      eventType: input.eventType,
      actorUserId: input.actorUserId ?? null,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      traceId: getTraceId() ?? null,
      metadataJson: metadata === undefined ? Prisma.DbNull : (metadata as Prisma.InputJsonValue),
    },
  });
}
