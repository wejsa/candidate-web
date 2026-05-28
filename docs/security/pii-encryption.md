# PII 암호화 SSOT (candidate-web)

본 문서는 candidate-web의 PII 컬럼 암호화 설계·운영·사고 대응의 단일 진실 소스(SSOT)입니다. 코드 자산은 `lib/crypto/aes-gcm.ts`, `lib/prisma/extends.ts`, `lib/pii/`에 있으며, 본 문서는 그 설계 의도·운영 절차·컴플라이언스 매핑을 명문화합니다.

| 항목 | 값 |
|------|-----|
| 도입 task | CANDID-008 |
| 후속 보강 | CANDID-030 (D2 key_version atomic), CANDID-031 (D6/D7/D8 3-layer defense), CANDID-034 (Application snapshot), CANDID-032 (D9 통합 테스트 매트릭스) |
| 알고리즘 | AES-256-GCM (NIST SP 800-38D) |
| 키 길이 | 32 bytes (256 bits) |
| IV 길이 | 12 bytes (96 bits, GCM 권장) |
| Auth tag 길이 | 16 bytes (128 bits) |
| 저장 컬럼 타입 | PostgreSQL `BYTEA` |
| 현재 키 버전 | v1 |

---

## 1. 개요 / 위협 모델

### 1.1 보호 대상 (PII)

| 모델 | 컬럼 | 비고 |
|------|------|------|
| `User` | `phone` (`Bytes`), `birthDate` (`Bytes`) | 회원 가입 시 입력. **BR-PII-01** (PII AES-256-GCM 컬럼 암호화 + 응답 마스킹). 키 버전: `phone_key_version`, `birth_date_key_version` (`SmallInt`, default 1) |
| `Application` | 5쌍 snapshot — `applicantNameSnapshot`, `applicantEmailSnapshot`, `phoneSnapshot`, `birthDateSnapshot`, `addressSnapshot` | 지원서 제출 시점 PII 스냅샷. **BR-PII-03** (회원 탈퇴 후에도 진행 중 지원 익명 보존 + 채용 종료 후 1년 자동 파기). 각각 `*_snapshot_key_version` 컬럼 보유 |

SSOT: `lib/pii/fields.ts` — `USER_PII_FIELDS`, `APPLICATION_PII_SNAPSHOT_FIELDS`. 비즈니스 규칙 SSOT는 `CLAUDE.md` §"핵심 비즈니스 규칙" — BR-PII-01 / BR-PII-03 (현재 PII 직접 관련 규칙).

### 1.2 위협 모델

| 위협 | 본 설계의 방어 |
|------|---------------|
| DB 덤프 유출 | AES-256-GCM 컬럼 암호화 — ciphertext만 노출 |
| DB 덤프 + 키 동시 유출 | 사고 대응 §7 (즉시 회전 SOP) |
| 애플리케이션 메모리 덤프 | **방어 외 위협** — 실행 중 평문 보유는 불가피. 운영 호스트 격리/접근 제어로 보완 |
| 응답 PII 노출 | `lib/pii/mask.ts` + `lib/pii/serializer.ts` (D7) |
| 로그/감사 PII 노출 | `PRISMA_LOG_QUERY` 운영 비활성 + `lib/audit-log.ts` (CANDID-026 예정) PII 마스킹 |
| 키 관리자의 우발적 변조 | env.ts zod 검증 (64-char hex 강제) + `lib/crypto/aes-gcm.ts:validateKey` 길이 검증 |
| 개발자의 우회 시도 | D6 (ESLint `no-restricted-syntax` `$queryRaw` 정적 차단) + D8 (`piiExtension.query.user.*` 런타임 가드 `assertUserPiiInputShape`) |

---

## 2. 알고리즘 사양

### 2.1 AES-256-GCM 선택 근거

| 속성 | AES-256-GCM | 비교 후보 |
|------|------------|----------|
| 인증 암호화(AEAD) | ✅ tag로 무결성 보장 | AES-CBC ❌ 별도 HMAC 필요 |
| Nonce 재사용 안전성 | ⚠️ 같은 (key, nonce) 재사용 시 catastrophic — IV 12B random + NIST SP 800-38D §8.3 권고 한도(임의 IV 사용 시 단일 키당 ≤ $2^{32}$ 메시지) 내 운영 | ChaCha20-Poly1305 동등 |
| 표준 | NIST SP 800-38D | RFC 7539 (ChaCha) |
| Node.js 표준 라이브러리 지원 | `node:crypto` 1급 지원 | 동등 |
| HW 가속 (AES-NI) | ✅ | ❌ (CPU 의존) |

**결정**: AES-256-GCM. 운영 호스트는 모두 AES-NI 가속 가능 + Node 표준 라이브러리만 사용 (외부 의존성 0).

### 2.2 IV 정책

- **매 암호화마다 `randomBytes(12)`로 새 IV** 생성 (`lib/crypto/aes-gcm.ts`의 `encryptPii`).
- IV는 ciphertext와 함께 저장되며 비밀이 아님. **동일한 평문이 매번 다른 ciphertext** 로 암호화됨 (PII 동일성 추론 차단).
- IV 재사용 위험: NIST SP 800-38D §8.3 권고에 따라 **임의 IV 사용 시 단일 키당 ≤ $2^{32}$ 메시지** 한도 내 운영. 본 한도에서 IV 충돌 확률 (birthday bound) ≤ $2^{-32}$. 본 한도에 근접하기 전 v2 키 회전 (§6) 권장.

### 2.3 Auth tag

- GCM tag(16B)는 ciphertext와 별도 저장하지 않고 `[iv][tag][ciphertext]` 단일 BYTEA에 함께 포장 (§3).
- 복호화 시 tag 검증 실패 → `decryptPii`가 throw → 위변조 또는 키 불일치 즉시 감지.

---

## 3. 저장 포맷

```
┌──────────┬──────────┬──────────────────┐
│ IV (12B) │ Tag (16B)│ Ciphertext (≥1B) │
└──────────┴──────────┴──────────────────┘
```

- 단일 PostgreSQL `BYTEA` 컬럼.
- **최소 길이 29 bytes** (12 + 16 + 1). 통합 테스트가 `octet_length ≥ 29` 단정 (`tests/integration/prisma-extends-user-write-guard.test.ts`).
- 헤더는 `lib/crypto/aes-gcm.ts:HEADER_LENGTH` (= `IV_LENGTH + TAG_LENGTH`).

### 3.1 마이그레이션 SQL

```sql
ALTER TABLE users
  ADD COLUMN phone BYTEA,
  ADD COLUMN phone_key_version SMALLINT DEFAULT 1,
  ADD COLUMN birth_date BYTEA,
  ADD COLUMN birth_date_key_version SMALLINT DEFAULT 1;
```

마이그레이션 파일: `prisma/migrations/20260512210900_candid_008_pii_encryption/migration.sql`.

---

## 4. 키 관리

### 4.1 환경 변수 — `PII_ENCRYPTION_KEY`

```bash
# 생성
openssl rand -hex 32

# 검증 (lib/env.ts:36)
# z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64-char hex (32 bytes)')
```

- **64자 hex** (= 32 bytes 256-bit).
- env.ts zod schema가 부팅 시 검증. 형식 불일치 → 부팅 차단.
- dev / staging / prod **분리 의무**. 같은 키 사용 시 dev DB 유출이 prod 평문 노출로 이어짐.
- 시크릿 매니저(AWS Secrets Manager / GCP Secret Manager / HashiCorp Vault) 주입 권장.

### 4.2 키 캐시 (`lib/crypto/aes-gcm.ts:cachedKey`)

- 모듈 레벨 `let cachedKey: Buffer | undefined` 캐시. 첫 호출 시 hex → Buffer 변환 후 reuse.
- 테스트 전용 `__resetCachedKeyForTesting()` 노출 (production 호출 시 throw — 운영 안전 가드).

### 4.3 키 버전 컬럼 — `*_key_version`

| 목적 | v2 키 도입 시 row 단위 키 버전 추적으로 무중단 회전 (§6) |
|------|---|
| 타입 | `SmallInt`, default 1 |
| 정책 | NULL 금지 (현재 default 1로 보장). 향후 v2 도입 시 신규 row는 2, 기존 row는 백필될 때까지 1 |
| atomic set 보장 | `encryptPiiWithVersion()` (`lib/prisma/extends.ts`) — ciphertext + keyVersion 동시 반환. 호출자가 두 값을 별도로 set하는 경로(race 가능) 차단 (CANDID-030 D2) |

---

## 5. 애플리케이션 표면 (3-Layer Defense — CANDID-031 / L-006)

PII 우회 가능 경로를 *3개의 독립 가드*로 다층 방어 (학습 ID **L-006** "PII는 3-layer defense-in-depth"). 한 layer가 깨져도 다른 layer가 차단.

본 절은 *컴포넌트 책임 매트릭스*이며, 요청→DB→응답 시퀀스 다이어그램은 별도 task(`docs/architecture/pii-data-flow.md`)에서 다룬다.

| Layer | 위치 | 책임 | 데이터 흐름 | 회귀 가드 |
|-------|------|------|------------|----------|
| **D6 — 정적 가드** | `.eslintrc.json` `no-restricted-syntax` | `$queryRaw` / `$queryRawUnsafe` / `$executeRaw` / `$executeRawUnsafe` 사용을 컴파일타임 차단 | write/read 양쪽 진입 | `pnpm lint` (CI 필수) |
| **D7 — 직렬화 가드** | `lib/pii/serializer.ts`, `lib/pii/mask.ts` | API Response 진입점에서 zod transform으로 마스킹 강제 + 내부 필드 strip | **read 후 응답 출구** | `tests/lib/pii/serializer.test.ts` |
| **D8 — 런타임 가드** | `piiExtension.query.{user,application}.*` 후크 + `assertUserPiiInputShape` / `assertApplicationPiiInputShape` named export | `prisma.user.create/update/upsert/updateMany/createMany`에 string 평문 입력 시 throw | **write 진입** (top-level only) | `tests/integration/prisma-extends-user-write-guard.test.ts` (11 케이스), `prisma-extends-application-write-guard.test.ts` (7 케이스) |

**흐름 진입 순서**:
- **write 경로**: D6 (정적) → D8 (런타임 query hook) → DB BYTEA (1차 방어)
- **read 경로**: DB → result extension(`compute*`) → 평문 string → D7 (응답 마스킹)

### 5.0 L-007 한계 — Nested Write 우회 (BR-PII-01 보강 컨벤션)

⚠️ **D8 런타임 가드는 *top-level write op only*** (`prisma.user.create({...})`). Prisma `query.{model}.{op}` 후크는 nested write를 trigger하지 않는다 — 예: `prisma.user.update({ data: { applications: { create: { ... } } } })` 형태의 nested `applications.create`는 `query.application.create` 후크가 **발동하지 않음**.

| 위험 vector | 차단 layer |
|-------------|----------|
| `prisma.X.create/update` 직접 평문 string | ✅ D8 |
| `prisma.X.update({...nested.create})` nested | ❌ D8 미발동 — D6 ESLint + 컨벤션(`encryptApplicationPiiSnapshotInput` 명시 호출 의무)로 보완. 통합 회귀 가드는 별도 task carry (CANDID-005-FU2) |
| `$queryRaw` / `$executeRaw` raw | ✅ D6 정적 + raw 경로 명시 호출 컨벤션 (`decryptUserPiiField`) + PostgreSQL BYTEA 1차 거부 |

신규 도메인 모델에 PII 추가 시 nested write 경로가 발생할 수 있는지 PR 리뷰에서 검토 의무.

### 5.1 쓰기 (encrypt)

명시적 헬퍼 호출. **string 평문을 직접 BYTEA 컬럼에 전달 금지**.

```ts
import { prisma } from '@/lib/prisma';
import { encryptUserPiiInput } from '@/lib/prisma/extends';

await prisma.user.create({
  data: {
    email: 'foo@bar.com',
    name: 'foo',
    ...encryptUserPiiInput({ phone: '010-1234-5678', birthDate: '1995-03-15' }),
  },
});
```

`encryptUserPiiInput` 내부:
1. 입력 정규화 (`normalizePhone` 9~11자리 / `normalizeBirthDate` ISO + 윤년 검증) — CANDID-030 D4
2. `encryptPiiWithVersion` 호출 → atomic `{ ciphertext, keyVersion }` 반환 — CANDID-030 D2
3. Buffer + key_version 동시 set → race 방지

Application snapshot (5쌍): `encryptApplicationPiiSnapshotInput` (`lib/prisma/extends.ts`). 같은 패턴.

### 5.2 읽기 (decrypt) — result extension

`prisma`(`@/lib/prisma` named export)는 `$extends(piiExtension)` wired. `findX` 결과의 `phone`/`birthDate` 등이 **자동 평문 string으로 복호화** 됨.

```ts
const user = await prisma.user.findUnique({ where: { id } });
// user.phone : 'string' (또는 null)
// user.birthDate : 'string' (또는 null)
```

내부: `piiExtensionResultDefinition.user.{phone,birthDate}.compute` (`lib/prisma/extends.ts`) — `computeDecryptedPhone`, `computeDecryptedBirthDate`가 BYTEA → 평문 변환. `needs`에 `{phone, phoneKeyVersion}` 양쪽 포함 (CANDID-030 D2 atomic 시그니처).

`piiExtensionResultDefinition`은 `deepFreeze`로 런타임 변조 차단 (CANDID-032 S-MAJOR-2 응답).

### 5.3 raw 경로 — `$queryRaw` + `decryptUserPiiField`

ESLint가 raw query를 차단하지만, *불가피한* 회귀 가드/조회 경로(예: 마이그레이션 검증)는 명시 `eslint-disable-next-line` + `decryptUserPiiField` 호출 컨벤션 사용.

```ts
// eslint-disable-next-line no-restricted-syntax -- <task-id>: <reason>
const rows = await prisma.$queryRaw<Array<{ phone: Buffer | null }>>`
  SELECT phone FROM users WHERE id = ${id}
`;
const plain = decryptUserPiiField(rows[0]?.phone);
```

⚠️ **raw 경로는 piiExtension result hook을 거치지 않음** — 자동 복호화 없음. 명시 호출 필수.
⚠️ raw `$executeRaw INSERT ... VALUES (..., 'string')`는 PostgreSQL BYTEA가 1차 거부 (driver coercion + invalid byte sequence) — 통합 테스트가 단정 (`prisma-extends-user-raw-bypass.test.ts`).
⚠️ **단 hex escape (`'\\x...'`) literal은 driver/DB가 BYTEA로 통과시킬 수 있음** — string literal 직접 삽입만 차단됨. 1차 방어가 모든 raw 우회를 차단하지 않으므로 **D6(ESLint 정적) + D8(런타임 가드 + 명시 컨벤션)** 이 본질적 보호. 1차 방어는 우발적 string 입력을 잡는 *마지막 safety net*.

### 5.4 응답 마스킹 (D7)

```ts
import { maskPhone, maskBirthDate } from '@/lib/pii/mask';

// 또는 serializer로 강제:
import { toUserPublic } from '@/lib/pii/serializer';
return Response.json(toUserPublic(user));
// phone → "010-****-5678", birthDate → "1995-**-**"
```

운영 응답에는 평문 PII 노출 금지. serializer 미통과 경로는 PR 리뷰 시 CRITICAL.

---

## 6. 키 회전 SOP (M1~M4 무중단 4단계)

⚠️ **본 절차는 *설계* 입니다.** 실제 실행 스크립트는 v2 키 도입 task 시점에 구축됩니다 (현재 미구현 — `lib/crypto/aes-gcm.ts:8` 주석 명시).

### 6.1 사전 준비 (M1 진입 prereq)

**M1 시작 전 다음 코드/배포가 완료되어 있어야 함** (D-MAJOR-6 응답: dual-read 미구현 상태로 M1 진입 시 v1 row 복호화 실패).

- `lib/crypto/aes-gcm.ts`를 *key-provider 패턴*으로 리팩토링: `getKeyByVersion(n: number): Buffer`.
- `encryptPiiWithVersion()`이 새 키 버전을 atomic 반환하도록 시그니처 확장.
- 모든 `compute*` 함수가 row의 `*_key_version` 값을 *분기해* v1/v2 키 선택 (**dual-read 활성**).
- 분기 로직 단위 테스트 + v2 키로 암호화한 row가 정상 read되는지 통합 테스트.
- 시크릿 매니저에 신키 등록 + dev/staging 환경에서 dual-read 검증 완료.

### 6.2 단계 매트릭스

| 단계 | 명칭 | 동작 | 검증 |
|------|------|------|------|
| **M1** | dual-write | 신키(v2) 모듈 활성 + 신규 INSERT/UPDATE는 v2로, 기존 v1 row는 dual-read로 그대로 복호화 | 신규 row의 `*_key_version` = 2 + v1 row read 정상 |
| **M2** | 백필 | 배치 job이 v1 row를 read(v1 dual-read 경로) → 평문 → encrypt(v2) → write(v2). 트랜잭션 단위 + 진행률 모니터링 | `phone_key_version = 1` count 단조 감소 |
| **M3** | 검증 | 전체 row `*_key_version = 2` 확인. v1 read 호출 발생 시 alert | `SELECT COUNT(*) WHERE phone_key_version = 1` = 0 |
| **M4** | 구키 제거 | v1 키 매니저에서 제거 + 코드의 v1 분기 삭제 + 배포 | v1 환경 변수/시크릿 stores 부재 확인 |

### 6.3 롤백 가능성 + 백업 보존 정책

- M1까지: 신키 미사용 row만 있으면 신키 즉시 폐기 가능.
- M2 진행 중: 일부 v2 row 존재 → 롤백 시 v2 키 보존 필수.
- M3 이후: 구키 제거 전까지 롤백 가능.
- M4 이후: 코드/배포 롤백 불가.

⚠️ **M4 후에도 *백업/감사 로그 보존 기간 동안* v1 키를 시크릿 매니저 archive로 보존 필수** (S-MAJOR-2 응답):
- WAL+PITR 백업이 30일 보존되고 audit log가 1년 보존된다면, **v1 키 보존 = max(DB backup retention, audit log retention)** 동안 archive 유지.
- archive 보존 기간 종료 시점에서만 진정한 v1 키 폐기.
- 위반 시 위험: M4 직후 DB corruption + PITR 복구 시도 → v1 row 전부 복호화 불가 → BR-PII-03(보존 의무) 위반 + 데이터 유실.
- archive는 *시크릿 매니저의 별도 namespace*(예: `pii-key-v1-archived`)에 보관 + 접근은 *재해 복구* 권한자만 + audit log 의무.

---

## 7. 사고 대응 (키 유출)

### 7.1 즉시 조치 (T+0 ~ T+1h)

1. **사고 신고** — 보안 책임자 + 컴플라이언스 팀 통지 (C-MAJOR-1 응답 — 정확한 법문은 §8.1 표 참조):
   - 개인정보보호법 §34 ① — 정보주체에게 **지체없이** 통지 (유출 항목 / 시점 / 경위 / 피해 최소화 조치 / 구제 절차).
   - 개인정보보호법 §34 ③ + 시행령 §40 — **1천명 이상** 유출 또는 **민감정보·고유식별정보 유출** 시 보호위원회/KISA 신고.
   - 통지/신고 세부 기한 (시간 단위) 및 양식은 **최신 시행령/보호위 고시 확인 필요** — 법적 자문 필수.
   - 별도로 GDPR Art. 33 적용 대상이라면 **72시간 이내** 감독기관 통지 (§8.2 참조).
2. **현황 평가**:
   - 유출 시점 추정 → 그 이후 신규 row + 그 이전 모든 row가 *모두* 위험 (구키로 암호화된 row 전체).
   - DB 덤프 동시 유출 여부 → 동시 유출이면 평문 노출 확정.
3. **신키(v2) 긴급 생성** (`openssl rand -hex 32`) + 시크릿 매니저 등록.
4. **dual-write 핫픽스 배포** — 신규 row만 v2로 저장. 기존 v1 read는 유지(서비스 단절 방지).
5. **전 인스턴스 롤링 재시작** (S-MAJOR-3 응답):
   - `lib/crypto/aes-gcm.ts`의 `cachedKey: Buffer`는 *모듈 레벨 캐시*로 프로세스 생애 동안 평문 키를 메모리에 보유.
   - dual-write 핫픽스가 배포되어도, 기존 워커가 캐시된 v1 키로 *계속 read 가능* → 공격자가 동일 시점 토큰으로 평문 추출 가능.
   - blue-green / rolling 배포로 **100% 신규 프로세스 교체 확인** 필수. `__resetCachedKeyForTesting`은 production throw — 운영에서 사용 불가.
   - follow-up: SIGHUP 등 key-reload signal 도입 검토 (별도 task).

### 7.2 백필 (T+1h ~ T+48h)

- `npm run rotate:pii --batch=1000 --interval=100ms` 같은 배치(M2). DB load 모니터링 + 실패 row 격리.
- 진행률 / 잔여 v1 row 수 / 처리 속도를 Grafana 대시보드(CANDID-027 도입 예정) 또는 임시 로그로 추적.

### 7.3 검증 + 폐기 (T+48h ~)

- `phone_key_version = 1` row가 0이 됨을 확인 (M3).
- 구키를 시크릿 매니저에서 제거 + 코드의 v1 분기 삭제 (M4).
- audit log: 사고 진입/조치/완료 시각 + 영향 범위(row 수, 사용자 수, PII 종류).

### 7.4 사후 분석

- 어떻게 키가 유출되었는가 (소스 코드 commit / 로그 / IaC 시크릿 / 인사이더).
- 재발 방지 — 시크릿 스캐닝(gitleaks 등) 도입, 최소 권한 원칙 점검, 키 로테이션 주기(예: 분기 1회) 정착.
- 회고 작성 (`docs/retro/INCIDENT-YYYYMMDD-pii-key-leak.md`).

---

## 8. 컴플라이언스 매핑

> 본 매핑은 **기술적 충족 측면**만 다룹니다. 법적 자문은 컴플라이언스 팀 검토가 필요합니다.

### 8.1 개인정보보호법 (대한민국)

| 조항 | 요구사항 | 본 구현의 충족 |
|------|---------|--------------|
| §28 ① — 안전성 확보 조치 | 개인정보 분실·도난·유출·위조·변조·훼손 방지 기술적/관리적 보호조치 | AES-256-GCM 컬럼 암호화 + 응답 마스킹 + 3-layer defense + audit log |
| §29 + 시행령 §30 + 보호위 고시 (개인정보의 안전성 확보조치 기준) | 비밀번호 일방향 암호화, 고유식별정보·생체정보 등 암호화 저장. **세부 기준은 개인정보보호위원회 고시 "개인정보의 안전성 확보조치 기준"** | phone/birthDate BYTEA AES-256-GCM 암호화. 비밀번호는 BCrypt strength 12 (별도) |
| §34 ① — 정보주체 통지 (유출 등의 사실) | **지체없이** 정보주체에게 통지 (시행령 §40에 통지 방법) | §7.1 사고 대응 SOP — 지체없이 통지 |
| §34 ③ + 시행령 §40 — 보호위/KISA 신고 | **1천명 이상** 유출 또는 **민감정보·고유식별정보 유출** 시 보호위원회/KISA에 신고. 세부 기한·양식은 최신 시행령 확인 | §7.1 사고 대응 SOP — 보호위/KISA 신고 |
| 시행령 §16 — 개인정보 파기 | 보유기간 경과 / 처리목적 달성 시 지체없이 파기 | BR-PII-03 — 회원 탈퇴 즉시 삭제 / 진행 중 지원 익명화 (CANDID-022 예정), 채용 종료 후 1년 자동 파기 (CANDID-029 예정) |

### 8.2 GDPR (유럽연합)

| 조항 | 요구사항 | 본 구현의 충족 |
|------|---------|--------------|
| Art. 32 — Security of processing | (a) pseudonymisation and encryption. "taking into account the state of the art" — 현 시점 권장 기준에 부합하는 조치 | AES-256-GCM (NIST SP 800-38D 권장) — 현 시점 권장 기준 부합 |
| Art. 32 — | (b) ensure confidentiality, integrity, availability, resilience | GCM AEAD = 기밀성 + 무결성 동시. PostgreSQL replication = availability + resilience |
| Art. 32 — | (c) restore the availability and access to personal data in a timely manner | DB backup (Postgres WAL + PITR 운영) + 본 문서 §7 사고 대응 |
| Art. 32 — | (d) regularly testing, assessing and evaluating | §9 회귀 테스트 매트릭스 + 정기 회고 |
| Art. 17 — Right to erasure ("right to be forgotten") | 정보주체 요청 시 지체없이 삭제 | BR-PII-03 — 회원 탈퇴 익명화 (CANDID-022 예정) |
| Art. 33 — Notification of breach | 인지 후 72시간 이내 감독기관 통지 | §7 사고 대응 SOP |

---

## 9. 테스트 / 회귀 가드

### 9.1 단위 테스트

- `tests/lib/prisma/extends.test.ts` — normalize{Phone,BirthDate}, encryptPiiWithVersion, encryptUserPiiInput, decryptUserPiiField, compute{Phone,BirthDate}, assertUserPiiInputShape, encryptApplicationPiiSnapshotInput 등 80+ 케이스.
- `tests/lib/pii/mask.test.ts` — 마스킹 형식 회귀.
- `tests/lib/pii/serializer.test.ts` — D7 직렬화 진입점 회귀.

### 9.2 통합 테스트 (V1/V2/V4 매트릭스 — CANDID-035 + CANDID-032)

| 파일 | 카테고리 | 케이스 |
|------|---------|--------|
| `tests/integration/prisma-extends-user-roundtrip.test.ts` | V2 + V4 | 8 — round-trip / partial update / updateMany D2 race / V4 needs 시그니처 (runtime + compile-time satisfies) / 음성 단정 (비-확장 PrismaClient → Uint8Array) |
| `tests/integration/prisma-extends-user-write-guard.test.ts` | V1 | 11 — 5 op × 2 field × string + `{set:'...'}` wrapper |
| `tests/integration/prisma-extends-user-raw-bypass.test.ts` | raw 경로 | 3 — 양성 ($queryRaw + decryptUserPiiField) / 음성 (extension 미발동) / PostgreSQL 1차 방어 ($executeRaw string→BYTEA 거부) |
| `tests/integration/prisma-singleton-wiring.test.ts` | L-005 | 3 — 운영 `import { prisma } from '@/lib/prisma'` singleton의 $extends wiring 직접 증명 (coverage exclude 보강) |
| `tests/integration/prisma-extends-application-{roundtrip,write-guard,nested-write}.test.ts` | Application 5쌍 | 13 (nested-write 1건 skip — Prisma 6 BYTEA driver 변경, CANDID-005-FU2 carry) |

### 9.3 V4 needs 시그니처 회귀 가드 (D9 — CANDID-032)

CANDID-032에서 `piiExtensionResultDefinition`을 별도 export하여 통합 테스트가 직접 introspect 가능. `needs` 컬럼명 오타/누락이 runtime + compile-time (`satisfies`) 양쪽에서 차단됨. Prisma 6의 `defineExtension`은 클로저 반환이라 wrapped 객체에서는 introspect 불가능 — raw definition export가 V4 가드의 전제.

### 9.4 Coverage 정책 (L-005)

`vitest.config.ts:coverage.exclude`가 `lib/prisma.ts`를 포함 (`server-only` import + `globalThis.__prisma` singleton 보호). 단위 통계 사각지대는 `prisma-singleton-wiring.test.ts`가 운영 모듈 경로의 `$extends(piiExtension)` wiring을 직접 증명하여 보강.

---

## 10. 변경 이력 / Cross-Reference

| Task | 변경 사항 | 회고 |
|------|----------|------|
| **CANDID-008** | PII 컬럼 도입 + `lib/crypto/aes-gcm.ts` + `piiExtension` result wiring + `encryptUserPiiInput` | `docs/retro/CANDID-008-retro.md` |
| CANDID-030 | D2 key_version atomic 결합 (`encryptPiiWithVersion`) + D4 입력 정규화 (`normalizePhone`/`normalizeBirthDate`) | retro 통합 |
| **CANDID-031** | D6 ESLint `no-restricted-syntax` + D7 `lib/pii/serializer.ts` + D8 `assertUserPiiInputShape` 런타임 가드 | `docs/retro/CANDID-031-retro.md` |
| CANDID-034 | Application 5쌍 snapshot + `encryptApplicationPiiSnapshotInput` + V1 가드 확장 | retro 통합 |
| **CANDID-032** | D9 통합 테스트 매트릭스 (V1/V2/V4) + L-005 singleton wiring smoke + `piiExtensionResultDefinition` export + `deepFreeze` 런타임 변조 차단 | `docs/retro/CANDID-008-retro.md` (D9 종결) |

### 10.1 코드 자산 인덱스

| 파일 | 역할 |
|------|------|
| `lib/crypto/aes-gcm.ts` | encryptPii / decryptPii 코어 + 키 캐시 |
| `lib/env.ts` | PII_ENCRYPTION_KEY zod 검증 (단일 진입점) |
| `lib/pii/fields.ts` | USER_PII_FIELDS / APPLICATION_PII_SNAPSHOT_FIELDS SSOT |
| `lib/pii/mask.ts` | 응답 마스킹 헬퍼 |
| `lib/pii/serializer.ts` | D7 직렬화 진입점 (zod transform fail-closed) |
| `lib/prisma/extends.ts` | `piiExtensionResultDefinition` (raw result hoist — V4 통합 테스트 introspect 대상, `deepFreeze` 런타임 변조 차단) + `piiExtensionDefinition` (name + result wrapper) + `piiExtension` (Prisma.defineExtension wired, query hook 포함) + encryptUserPiiInput / encryptApplicationPiiSnapshotInput / assertUserPiiInputShape / decryptUserPiiField / compute* 함수들 |
| `lib/prisma.ts` | `$extends(piiExtension)` wired singleton (`prisma` named export) |
| `tests/integration/prisma-extends-*.test.ts` | V1/V2/V4 통합 회귀 가드 |
| `tests/integration/helpers/{seed,raw,prisma}.ts` | encryptUserPiiInputForPrisma / encryptApplicationSnapshotForPrisma / getUserPiiRaw / getApplicationSnapshotRaw / getTestPrisma / truncateAll |
| `prisma/migrations/20260512210900_candid_008_pii_encryption/` | 초기 PII 컬럼 마이그레이션 |

### 10.2 Follow-up (carry)

| 항목 | 상태 |
|------|------|
| `docs/architecture/pii-data-flow.md` (시퀀스 다이어그램) | TODO — 별도 task |
| `.claude/rules/general/typescript/pii-encryption.md` (룰 파일) | TODO — CANDID-008 retro Try #4 |
| L-007 nested write 회귀 가드 대체 형태 (Prisma 6 driver 변경 대응) | CANDID-005-FU2 |
| Application/User write-guard 매트릭스 갭 (upsert update wrapper / updateMany wrapper / createMany happy multi-row) | TBD |
| v2 키 도입 + 실제 회전 스크립트 (M1~M4 실행 자산) | 별도 task (운영 진입 시점) |

---

## 11. 운영 체크리스트 / 비공개 정보 분리

### 비공개 정보 분리 (S-MINOR-2 응답)

본 SSOT 문서는 *공개 가능한 설계·절차* 만 다룬다. 다음은 **사내 비공개 runbook** 으로 분리하여 본 문서와 별도 보관 (접근 권한 최소화):

- 실제 키 값 / hex hash
- 키 회전 실시 일정 (분기/연 등 *구체적* 타임라인)
- 시크릿 매니저 경로 / namespace / IAM 정책 상세
- 백필 배치 윈도우 (운영 트래픽 분석 결과)
- 사고 대응 담당자 연락처 / 에스컬레이션 체인

### 운영 체크리스트

- [ ] `.env.{development,staging,production}` 키 분리 + 시크릿 매니저 관리
- [ ] 시크릿 스캐닝(gitleaks 등) CI 통합 — 키가 git에 commit되지 않도록
- [ ] PostgreSQL backup 정책 — WAL + PITR (최소 30일)
- [ ] Audit log 보존 정책 — PII 마스킹 + 1년 이상
- [ ] 사고 대응 SOP 정기 훈련 — §7 시뮬레이션 (분기 1회 권장)
- [ ] 회귀 테스트 CI 게이트 — `pnpm test`(단위) + `pnpm test:integration`(docker-compose db 필요) 모두 그린

---

**SSOT 갱신 책임**: PII 관련 신규 task는 본 문서 §10 이력 + 관련 섹션 갱신 필수. 본 문서가 코드/스키마와 drift되지 않도록 PR 리뷰 시 cross-link 검증.
