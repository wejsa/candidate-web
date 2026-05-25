# DB 설계 컨벤션

> **기본값**: MySQL 8.0+ · Flyway 마이그레이션. 다른 SQL DB(PostgreSQL 등)나 마이그레이션 도구(Liquibase/Alembic/Prisma migrate 등) 사용 시 `project.json`의 `techStack.database`만 변경하세요. Claude가 컨텍스트에 맞춰 구문을 적용합니다(예: `TINYINT(1)` → `BOOLEAN`, `AUTO_INCREMENT` → `IDENTITY`, `JSON` → `JSONB`).
>
> **본 컨벤션의 정책은 DB·도구와 무관하게 적용됩니다.** MongoDB·DynamoDB 등 NoSQL은 본 컨벤션의 *정책*(필수 컬럼 의미, Soft Delete, 낙관적 잠금)만 차용하고 스키마/쿼리는 도큐먼트 모델에 맞게 별도 작성하세요.
>
> 팀 표준을 추가로 강제하려면 본 파일 끝에 `<!-- CUSTOM_SECTION_START -->` ~ `<!-- CUSTOM_SECTION_END -->` 마커를 추가하세요 (커스터마이징 가이드: `docs/customization.md`).

도메인별 데이터 모델(결제 테이블, 상품 테이블 등)은 해당 도메인 문서를 참조하세요.

## 테이블 네이밍

| 규칙 | 예시 |
|------|------|
| snake_case | `user_accounts`, `payment_transactions` |
| 복수형 | `users`, `orders`, `payments` |
| 접두사 금지 | ~~`tbl_users`~~ → `users` |
| 연결 테이블 | `{table1}_{table2}` (알파벳순) — `order_products` |

## 컬럼 네이밍

| 규칙 | 예시 |
|------|------|
| snake_case | `user_name`, `created_at` |
| PK | `id` |
| FK | `{참조테이블_단수형}_id` — `user_id`, `order_id` |
| Boolean | `is_` 접두사 — `is_active`, `is_deleted` |
| 날짜/시간 | `_at` 접미사 — `created_at`, `updated_at` |
| 금액 | 명확한 의미 표현 — `total_amount`, `discount_amount` |

## 필수 컬럼

| 컬럼 | 필수 | 용도 |
|------|:---:|------|
| `id` | ✅ | Primary Key (서로게이트) |
| `created_at` | ✅ | 생성 시각 (UTC) |
| `updated_at` | ✅ | 수정 시각 (UTC) |
| `deleted_at` | ❌ | Soft Delete 사용 시 |

> 시간은 UTC 저장. 금액은 부동소수점 금지(고정소수 정밀 타입 사용).

## 제약조건 네이밍

| 유형 | 패턴 | 예시 |
|------|------|------|
| Primary Key | `pk_{table}` | `pk_users` |
| Unique | `uk_{table}_{col}` | `uk_users_email` |
| Foreign Key | `fk_{table}_{col}` | `fk_orders_user_id` |
| Index | `idx_{table}_{col}` | `idx_users_created_at` |
| Check | `ck_{table}_{col}` | `ck_payments_amount` |

## 기본 정책

- **Soft Delete**: 감사 추적이 필요한 도메인(fintech/healthcare 등)은 `deleted_at` 사용. 모든 활성 조회에 `deleted_at IS NULL` 조건 필수.
- **낙관적 잠금**: 동시 수정 가능한 엔티티는 `version` 컬럼 + `WHERE version = ?` 패턴. affected rows = 0 시 충돌 → 재시도 또는 예외.
- **마이그레이션**: 버전 관리, 한 번만 실행, 설명 가능한 식별자(파일명 또는 revision ID)를 모든 도구에서 일관되게 적용. Flyway 사용 시 `V{N}__{snake_case_description}.sql`을 표준으로 채택. 다른 도구는 해당 도구의 표준 식별자 체계(Liquibase changelog ID, Alembic revision, Prisma 타임스탬프 prefix 등)를 그대로 따름.

## 무중단 마이그레이션 원칙

| 변경 유형 | 전략 |
|----------|------|
| 컬럼 추가 | NULL 허용 추가 → 데이터 채움 → NOT NULL 변경 |
| 컬럼 삭제 | 코드에서 참조 제거 → 다음 배포에서 컬럼 삭제 |
| 컬럼 타입 변경 | 새 컬럼 추가 → 데이터 마이그레이션 → 기존 컬럼 삭제 |
| 테이블 이름 변경 | 새 테이블 생성 → 동기화 → 기존 테이블 삭제 |
| 인덱스 추가 | DB가 지원하는 동시(non-blocking) 옵션 사용 [^1] |

[^1]: PostgreSQL: `CREATE INDEX CONCURRENTLY` · MySQL 8.0+: 온라인 DDL 디폴트(`ALGORITHM=INPLACE, LOCK=NONE`) · MongoDB: `db.collection.createIndex({...}, {background: true})` (4.0+ 기본 동작).

> 위험한 DDL(대용량 테이블 ALTER, DROP, RENAME, FK 추가)은 영향 분석 + 롤백 계획 필수.

### Destructive migration guard (PostgreSQL)

Dev-only destructive 마이그레이션(`DROP COLUMN`, `TYPE` 변경 등)은 SQL 본문 상단에 **운영 데이터 존재 시 fail-safe로 차단하는 guard**를 동반해야 한다. 단순 주석(`-- dev-only`)만으로는 `prisma migrate deploy` / `flyway migrate` 등이 환경 구분 없이 적용해 운영 데이터가 영구 소실될 수 있다.

```sql
-- Guard: <table>에 데이터가 1건이라도 있으면 마이그레이션 차단 (운영 적용 방지).
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "users") > 0 THEN
    RAISE EXCEPTION 'destructive migration aborted: users 테이블에 % rows 존재. 무중단 절차(M1~M4)로 전환하세요.',
      (SELECT COUNT(*) FROM "users");
  END IF;
END $$;

ALTER TABLE "users"
  DROP COLUMN "old_col",
  ADD COLUMN "new_col" BYTEA;
```

| 대상 변경 | guard 필요 여부 |
|----------|:--------------:|
| `DROP COLUMN` | ✅ |
| 컬럼 `TYPE` 변경 (호환 불가) | ✅ |
| `DROP TABLE` | ✅ |
| `RENAME COLUMN` / `RENAME TABLE` | ⚠ 권장 |
| 컬럼 추가 (NULL 허용) | ❌ |
| 인덱스 추가/삭제 | ❌ |

**MySQL/MariaDB**에서는 `SIGNAL SQLSTATE` + procedural block 또는 별도 사전 검증 스크립트를 사용한다. MongoDB는 destructive migration 개념이 다르므로 적용 안 함.

> **출처**: CANDID-008 회고 (docs/retro/CANDID-008-retro.md, A5).

---

## CHECK 제약과 NULL semantics

CHECK 제약은 표현식 결과가 **FALSE일 때만** 위반으로 차단한다. `NULL`이 포함된 표현식은 종종 `UNKNOWN`으로 평가되어 *통과*하므로, NULL 가능 컬럼에 대해 boolean 연산자(`XOR`, `AND`, `OR`)를 직접 사용하면 의도와 다른 false positive가 발생한다.

### 안티패턴 (PostgreSQL)

```sql
-- 의도: "(a, b) 중 정확히 하나가 NULL"
-- 결함: 둘 다 NULL이면 (NULL IS NULL XOR NULL IS NULL) = (TRUE XOR TRUE) = FALSE
--        그러나 'CHECK (a IS NULL XOR b IS NULL)'을 그냥 본 NULL XOR 형식은
--        NULL 비교 의도가 모호하면 UNKNOWN 평가 경로로 빠질 수 있음.
ALTER TABLE resume_files
  ADD CONSTRAINT ck_resume_files_attachment_xor
  CHECK (existing_resume_id IS NULL XOR uploaded_path IS NULL);
```

### 안전 패턴

```sql
-- 옵션 1: "정확히 하나가 NOT NULL" — boolean XOR 효과를 비교 연산으로 표현
ALTER TABLE resume_files
  ADD CONSTRAINT ck_resume_files_attachment_xor
  CHECK ((existing_resume_id IS NULL) <> (uploaded_path IS NULL));

-- 옵션 2: "최대 한 컬럼만 NOT NULL" — num_nonnulls 사용 (PostgreSQL 9.5+)
ALTER TABLE resume_files
  ADD CONSTRAINT ck_resume_files_attachment_at_most_one
  CHECK (num_nonnulls(existing_resume_id, uploaded_path) <= 1);

-- 옵션 3: "정확히 하나만 NOT NULL" — num_nonnulls = 1
ALTER TABLE resume_files
  ADD CONSTRAINT ck_resume_files_attachment_exactly_one
  CHECK (num_nonnulls(existing_resume_id, uploaded_path) = 1);
```

### 리뷰 체크리스트

| 항목 | 확인 |
|------|------|
| CHECK 표현식에 NULL 가능 컬럼이 있는가 | `IS NULL` / `IS NOT NULL` 명시 또는 `num_nonnulls(..)` 사용 |
| boolean 연산자(`XOR`, `AND`, `OR`)를 직접 사용했는가 | 비교 연산자(`<>`, `=`) 또는 `num_nonnulls(..)`로 대체 검토 |
| 의도 문구(주석)가 SQL 의미와 일치하는가 | "XOR" 자연어 ≠ SQL `XOR` 연산자 — `at most one` / `exactly one` / `not both` 등 정확히 명시 |

**MySQL 8.0+**는 `XOR` 키워드를 지원하나 동일한 NULL semantics 함정이 있다. `num_nonnulls`는 미지원이라 `((a IS NULL) <> (b IS NULL))` 형태로 작성한다.

> **출처**: CANDID-005 회고 (docs/retro/CANDID-005-retro.md, L-016) — resume_files CHECK 제약 'XOR' 의미 충돌이 Step 2 PR #12 C001의 원인.

---

## 민감 컬럼(PII) 메타데이터는 SSOT 상수에서 derive

PII로 분류되는 컬럼명(예: `phone`, `birthDate`)은 모듈 곳곳에 *하드코딩*되는 경향이 있다 — 암호화 헬퍼, 마스킹 직렬화, write 런타임 가드, 응답 schema 등. 신규 PII 컬럼이 추가될 때 한 위치만 갱신하고 다른 위치를 누락하면 누설 위험이 발생한다.

대신 **단일 상수 (SSOT)** 에서 derive하여 모든 보호 계층이 동일한 필드 집합을 참조하도록 한다.

```ts
// lib/pii/fields.ts (SSOT)
export const PII_FIELDS = ['phone', 'birthDate'] as const;
export type PiiField = (typeof PII_FIELDS)[number];

// lib/prisma/extends.ts — 런타임 가드
import { PII_FIELDS } from '@/lib/pii/fields';
export function assertUserPiiInputShape(data: unknown): void {
  if (data === null || data === undefined || typeof data !== 'object') return;
  const d = data as Record<string, unknown>;
  for (const field of PII_FIELDS) {
    if (field in d) {
      const v = d[field];
      if (typeof v === 'string' || isStringSetWrapper(v)) {
        throw new Error(piiViolationMessage(field));
      }
    }
  }
}

// lib/pii/serializer.ts — 직렬화 mapper
// userPublicInputSchema에 PII_FIELDS 기반 필드 정의 적용 (mask 헬퍼 결합).
```

| 적용 대상 | 의도 |
|----------|------|
| 암호화 헬퍼 (`encryptUserPiiInput`) | 인식하는 필드 집합 SSOT |
| 직렬화 schema (`userPublicSchema`) | 마스킹/검증 대상 SSOT |
| 런타임 가드 (`assertUserPiiInputShape`) | 차단 대상 SSOT |
| 도메인 docs / 컴플라이언스 매핑 | 어떤 컬럼이 PII인지 단일 답 |

신규 PII 컬럼 추가 시 본 SSOT 한 곳 갱신 → 모든 보호 계층이 자동으로 신규 컬럼 인식. TypeScript `as const` 리터럴 타입으로 컴파일 타임 안전성 확보.

> **출처**: CANDID-031 회고 (docs/retro/CANDID-031-retro.md, A8 / FU2-F).

## PII 모델의 nested write 우회 차단 (L-007)

Prisma `query.{model}.{op}` 후크는 **top-level write에만 발동**한다. `prisma.user.update({ data: { applications: { create: { applicantNameSnapshot: '평문' } } } })`처럼 상위 모델 관계로 child를 생성하는 *nested write*는 `query.application` 후크를 trigger하지 않으므로 `assertApplicationPiiInputShape` 런타임 가드가 우회된다 — 평문 string이 UTF-8 raw bytes로 BYTEA 컬럼에 저장된다.

**컨벤션**: PII 컬럼이 있는 모델은 항상 **top-level `prisma.{piiModel}.create/update/upsert(...)` 직접 호출** 또는 `encrypt{Model}PiiInput(...)` / `encrypt{Model}PiiSnapshotInput(...)` 명시 사전 적용. 상위 모델 관계로 nested write 금지.

회귀 차단: `tests/integration/prisma-extends-application-nested-write.test.ts`가 L-007 한계의 SSOT 증거로 동작 (fail = wiring 강화 → 컨벤션 갱신 필요).

> **출처**: CANDID-035 Step 3 (docs/retro/CANDID-034-retro.md §3 A1, L-007).

## Prisma migrate deploy의 트랜잭션 wrap — CONCURRENTLY 금지 (L-029)

Prisma `migrate deploy`는 각 마이그레이션 파일을 **BEGIN..COMMIT 트랜잭션으로 자동 wrap**한다 (prisma issue #11164). PostgreSQL `CREATE INDEX CONCURRENTLY`는 트랜잭션 블록 안에서 실행 불가하므로 (`ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block`) 운영 첫 배포 시 마이그가 100% 실패한다.

**컨벤션**: Prisma `migration.sql`에 `CONCURRENTLY` 사용 금지. 대신:
1. **소량 테이블 + ms 수준 락 허용**: 일반 `CREATE [UNIQUE] INDEX IF NOT EXISTS` 사용 (CANDID-016 채택 — resume_files 운영 초기 0~1k rows)
2. **대량 테이블 + 락 회피 필수**: 별도 runbook으로 `psql -c "CREATE INDEX CONCURRENTLY ..."` 사전 실행 + 마이그는 `IF NOT EXISTS` no-op
3. `IF NOT EXISTS` 패턴은 항상 권장 (재실행 안전).

**회귀 가드** (CANDID-038부터 자동화 — Node.js/Prisma 프로젝트 한정):
- 도구: `pnpm check:migrations` (구현: `scripts/check-migrations-no-concurrently.mjs`)
- 정규식: 파일 전체 매칭 + `stripSqlComments`(`--`, `/* */` 모두 공백 치환, 라인 보존)로 멀티라인 SQL + 코멘트 false-negative/positive 동시 차단
- allowlist: `.claude/state/migration-concurrently-allowlist.txt` (한 줄당 파일 경로). legacy 마이그(예: CANDID-013 v1)는 grandfather 등재
- 호출 시점: PR 리뷰 단계 — `skill-review-pr` SKILL.md §2.4 "Pre-Review Guard Execution" 매핑 표가 `prisma/migrations/**/migration.sql` 변경 감지 시 자동 호출. 가드 fail 시 즉시 REQUEST_CHANGES + 3-에이전트 리뷰 스킵 (CANDID-042 PR, wiring 완료)
- L-034 정책: 본 가드 자체의 단위 테스트는 가드 도입 PR에 동반 (CANDID-041에서 15 fixture로 충족 — `tests/scripts/check-migrations-no-concurrently.test.ts`)
- L-036 정책: 자동 호출 wiring은 `skill-review-pr` SKILL.md §2.4 declarative 매핑 표에서 SSOT 관리. 신규 가드 추가 시 (스크립트 + vitest + 표 등록) 3종 세트 PR 필수

> **출처**: CANDID-016 Step 1 in-PR fix(D-MAJOR-1) PR #57 + CANDID-038 follow-up PR #60 (자동 가드 + DROP+CREATE 신규 마이그). 도구 구현은 다른 ORM/언어로 직접 이식 불가 — Node.js/Prisma 환경 한정 절차.

## Partial UNIQUE 인덱스의 상태 컬럼 포함 (L-033)

활성 row 1건 강제용 partial UNIQUE 인덱스의 `WHERE` 절에 상태 컬럼을 포함하면, 비활성 상태(`INFECTED`/`FAILED`/`DELETED` 등) row가 잔존해도 새 활성 row 생성을 허용해 사용자 재시도 흐름이 자연스럽게 보존된다.

**패턴 예시** (CANDID-016 resume_files):
```sql
CREATE UNIQUE INDEX uk_resume_files_one_per_draft
  ON resume_files(draft_id)
  WHERE draft_id IS NOT NULL AND virus_scan_status IN ('PENDING', 'CLEAN');
```

**효과**:
- INFECTED row hard-delete 정책과 분리 (audit 추적성 유지)
- 사용자가 INFECTED 통보 후 깨끗한 파일 재업로드 → partial UNIQUE 평가 외 → 정상 흐름

**plan 단계 가드**: db-designer 권고에 *"활성 row 강제 시 평가 대상 상태 컬럼 명시"*를 포함하여 Step 2 이후 추가 마이그 회피.

> **출처**: CANDID-016 D-MAJOR-2 정책 결정, PR #58.
