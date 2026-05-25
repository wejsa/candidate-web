# CANDID-016 회고 — 이력서 파일 첨부 (Pre-signed URL + MIME 화이트리스트 + UUID 재명명)

## 기본 정보

| 항목 | 값 |
|------|-----|
| Task ID | CANDID-016 |
| 제목 | 이력서 파일 첨부 (US-APP-003) |
| Phase / Priority | 2 / high |
| 시작 | 2026-05-24 20:21 (조기 잠금) |
| 완료 | 2026-05-25 10:47:07 |
| 총 PR | 3건 (#57, #58, #59) |
| 머지 LOC 합계 | **2,658** (Step 1 500 + Step 2 1,208 + Step 3 950) |
| 테스트 추가 | **+123** (969 → 1,092) |
| 신규 의존성 | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @smithy/node-http-handler |
| fixLoop | 1회 (Step 3 vitest config drift) |
| in-PR fix | 13건 (Step 1: 4 / Step 2: 5 / Step 3: 4) |
| carry | 28건 (Step 3 follow-up 후보) |

## 1. Speed

### 스텝별 흐름
| Step | 본체 PR | review | in-PR fix | 머지 |
|------|--------|--------|-----------|------|
| 1 (인프라) | 23:35 | 20:45 (#57) | 20:55 | 23:42 |
| 2 (API+비즈니스) | 09:55 | 10:05 (#58) | 10:15 | 10:14 |
| 3 (UI+상태머신) | 10:30 | 10:35 (#59, CRITICAL 1) | 10:46 (회차 2) | 10:47 |

- Step 1 본체 LOC ~500, in-PR fix 후 +108 (~600 LOC)
- Step 2 본체 LOC ~1100, in-PR fix 후 +108 (~1200 LOC) — **prLineLimit 900의 1.22× (강력 경고)**
- Step 3 본체 LOC ~950 (in-PR fix +44 = ~994) — **prLineLimit 700의 1.36× (강력 경고)**

### 병목 / 관찰
- 자기 PR(`wejsa`)이라 GitHub APPROVE 정책상 모든 리뷰가 REQUEST_CHANGES 또는 COMMENT 처리 — 3회 발생
- 다관점(domain+security+test) 합의 MAJOR가 매 PR에서 다수 발견 — in-PR fix 사이클이 13건으로 누적
- D-MAJOR-2 정책 결정 (INFECTED row 처리)은 Step 1 plan 단계에서 정의되지 않아 Step 2 시작 시 추가 마이그 발생

## 2. Quality

| 지표 | 값 |
|------|-----|
| 총 리뷰 라운드 | 4 (PR #57 × 1, #58 × 1, #59 × 2) |
| CRITICAL 발견 | 1 (Step 3 vitest config drift) |
| MAJOR 발견 | 41 (#57: 19, #58: 10, #59 1차: 12) |
| MINOR/INFO | 30 / 18 |
| In-PR fix율 | **31%** (13/41 MAJOR) |
| Carry율 | 69% (28/41) → follow-up |
| 첫 리뷰 CRITICAL 통과율 | 2/3 PR (#57, #58은 0 CRITICAL) |
| skill-fix 호출 | 1회 (Step 3 1라인 vitest config) |
| 빌드/테스트 통과 | 100% (모든 PR 머지 전 검증) |

### 다관점 합의 MAJOR (3 agent 동시 지적) 추적
- **#57**: D-MAJOR-1+S-MAJOR-1 (S3_ENDPOINT URL 검증), D-MAJOR-1+T-MAJOR-11 (DB partial UNIQUE 가드)
- **#58**: D-MAJOR-1+S-MAJOR-1 (P2002 target 검증), S-MAJOR-2+T-MAJOR-1 (HWP octet-stream fallback)
- **#59**: T-CRITICAL-1 단일관점 (config drift)

## 3. Patterns

### 자주 수정된 파일
| 파일 | 수정 횟수 (PR 단위) |
|------|-------------------|
| `lib/files/storage.ts` | 3회 (#57 본체/in-PR + #58 carry fix) |
| `lib/files/validation.ts` | 2회 (#58 본체 + #58 in-PR octet-stream) |
| `lib/files/resume.ts` | 2회 (#58 본체 + #58 in-PR P2002 분리) |
| `app/jobs/[id]/apply/_components/ResumeUploadStep.tsx` | 2회 (#59 본체 + #59 in-PR 3건) |
| `lib/files/upload-state.ts` | 2회 (#59 본체 + #59 in-PR INFECTED) |

### 반복 이슈 유형
1. **P2002 무차별 매핑** — 같은 패턴이 CANDID-010 (signup), CANDID-036 (email verification)에서도 발생. SSOT 헬퍼 추출 필요
2. **AWS/외부 SDK cause leak** — 본 task에서 처음 등장, safeS3Cause 패턴 정립
3. **partial UNIQUE 정책 결정 시점** — Step 1 plan 단계가 아닌 Step 2 진입 후에 발견 → 추가 마이그
4. **Prisma migrate 트랜잭션 wrap** — CANDID-013 동일 패턴 회귀 위험 (follow-up task 등록 필요)

### 스킬 실행 순서
표준 흐름 100% 준수:
```
plan → impl → review → (fix → review)? → merge → impl --next (×3) → retro
```
Step 3에서만 skill-fix 1회 발동 (vitest config drift 단순 fix).

## 4. Decisions

### 4.1 D-MAJOR-2: INFECTED row 정책 (사용자 확정)
- **결정**: partial UNIQUE에 `virus_scan_status IN ('PENDING','CLEAN')` 조건 추가 → INFECTED/FAILED row 잔존 + 재업로드 가능
- **대안 거부**: INFECTED row hard-delete → audit 추적성 손실
- **트레이드오프**: row 누적 (운영 시 INFECTED 1% 가정 시 무시 가능)

### 4.2 RTL 미설치 — minimal renderer 채택 (Step 3)
- **결정**: ResumeUploadStep 컴포넌트 RTL 테스트는 follow-up
- **사유**: RTL 도입 비용 + CANDID-015 minimal renderer 패턴 활용 비용 모두 본 task 범위 초과
- **대안**: client.ts + upload-state.ts 단위 테스트로 핵심 회귀 가드 확보

### 4.3 carry MAJOR 처리 — 다관점 합의 우선
- **결정**: 다관점 합의 (3 agent 동시 지적) MAJOR는 즉시 in-PR fix, 단일관점은 follow-up
- **결과**: 13/41 fix (31%), 28 carry (69%) — fix loop 1회로 절제

### 4.4 Prisma 마이그 CONCURRENTLY 제거 (Step 1 in-PR)
- **결정**: `CREATE INDEX CONCURRENTLY` → 일반 `CREATE UNIQUE INDEX`
- **근거**: Prisma migrate deploy가 마이그 파일을 트랜잭션으로 wrap → CONCURRENTLY 실행 불가
- **부수효과**: CANDID-013 동일 패턴 회귀 위험 → follow-up task 등록 권장

## 5. Lessons (Keep / Improve / Learn / Try)

### Keep
1. **L-019 in-task self-correction** — Step 2가 Step 1 carry MAJOR 3건 자체 보강 (fix loop 0회 추가)
2. **다관점 합의 우선 처리** — 운영 회귀 위험 식별 신뢰도 ↑
3. **사용자 의사결정 포인트 명시** — 정책 결정 + carry 전략을 매 라운드 확인

### Improve
1. **plan 단계 테스트 인프라 확인** — RTL/jsdom 가용성을 Step 분리 전에 점검 (Step 3 진입 시 발견)
2. **partial UNIQUE 정책 결정 시점** — Step 1 plan에서 INFECTED/FAILED 처리 정책 미리 확정 (Step 2 추가 마이그 회피)
3. **config drift 자동 검사** — vitest config dead reference (Step 3 T-CRITICAL-1)가 review에서야 발견

### Learn (lessons-learned.json 등록 대상)
1. **Prisma migrate 트랜잭션 wrap → CONCURRENTLY 사용 불가**
2. **P2002 매핑은 `err.meta.target` 검증 필수** — 다른 UNIQUE 인덱스 추가 시 오매핑 차단
3. **MIME 화이트리스트에서 generic `application/octet-stream` 제외** — 악성 파일 위장 차단
4. **외부 SDK cause는 `safeXxxCause()` 화이트리스트 후 AppError 전달** — signature/credentials leak 차단
5. **partial UNIQUE에 상태 컬럼 포함 시** INFECTED row 잔존 + 사용자 재시도 흐름 보존 가능

### Try
1. **vitest config drift 자동 검사** — CI 또는 pre-push hook으로 dead reference 차단
2. **partial UNIQUE 정책을 db-designer 권고에 포함** — 상태 컬럼 평가 여부 명시
3. **RTL 도입 follow-up task** — 컴포넌트 테스트 인프라 정식화

## 6. Action Items

| 우선순위 | 항목 | Owner |
|---------|------|-------|
| HIGH | **CANDID-013 마이그 CONCURRENTLY 제거** (회귀 위험 동일 패턴) | follow-up task |
| HIGH | **RTL 컴포넌트 테스트 인프라 도입** + ResumeUploadStep.test.tsx 작성 | follow-up task |
| HIGH | **CANDID-016 Step 3 carry MAJOR 9건** (draftId/jobId 명명, race, dev warn, https 가드, orphan, T-MAJOR 4건) | follow-up task |
| MED | **MIME 화이트리스트 컨벤션 추가** — generic MIME 거부 | conventions PR |
| MED | **P2002 SSOT 헬퍼 추출** — `lib/db/prisma-errors.ts`로 일반화 | refactor task |
| LOW | **safeS3Cause 일반화** — `safeAwsCause()` 또는 SDK 무관 패턴 | refactor task |

## 7. 참고

- 계획: `.claude/temp/CANDID-016-plan.md` (완료 후 삭제)
- 코드: PR [#57](https://github.com/wejsa/candidate-web/pull/57), [#58](https://github.com/wejsa/candidate-web/pull/58), [#59](https://github.com/wejsa/candidate-web/pull/59)
- 머지 커밋: e3d161f, 55cad57, a8ab034
- spec: docs/sample-requirement.md US-APP-003 + BR-FILE-01~07 + §3.3.6
