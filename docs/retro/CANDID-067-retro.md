# CANDID-067 회고 — backlog.json 스키마 정합성 정리

| 항목 | 값 |
|------|-----|
| Task ID | CANDID-067 |
| 제목 | backlog.json 스키마 정합성 정리 — 전체 검증 위반 241건 |
| 유형 / 우선순위 | chore / high (Phase 4) |
| 시작 → 완료 | 2026-06-10 20:45 → 21:20 (약 35분) |
| 스텝 / PR | 1 스텝 / PR #168 (squash, +763/-701) |
| 출처 | aick-health-check SI-04 MAJOR 자동 등록 |
| 품질 | CRITICAL 0 · 머지 차단 0 · 리뷰 2회차 수렴 |

## 1. Speed

- 단일 스텝, 총 ~35분. plan(5분) → impl(10분) → review 1차(3-agent, ~2.5분) → fix 번들(10분) → review 2차(2-agent) → fix(5분) → merge.
- 병목: **리뷰 후 in-task fix가 2라운드**. 1차 4 MAJOR fix → 2차 재리뷰에서 내가 fix하며 단 주석이 거짓(키셋 핀 미구현)임을 잡아 재fix. 리뷰가 비용을 만든 게 아니라 **첫 fix 때 주석과 구현을 함께 검증하지 않은 것**이 1라운드를 추가했다.

## 2. Quality

- 전 회차 **CRITICAL 0 / 보안 0**. jsonschema 위반 **241 → 0**, 멱등성·데이터 무결성(stepNumber 3건·prNumber/files/mergedAt 전량 보존) 확인.
- 1차 3-agent 리뷰: MAJOR 4 (stepNumber 별칭·`--check` 부수효과·테스트 부재·죽은 가드) — 전부 in-task 해소.
- 2차 재리뷰: 신규 MAJOR 1 (주석이 약속한 `EXPECTED_*_KEYS` 핀 미구현) — `--print-keys` + 테스트 핀으로 실구현.
- 테스트 2294 → 2311 (+17, 신규 가드 단위 테스트).

## 3. Patterns

- **반복 지적 (다른 Task에서도 발생한 유형)**:
  - 회귀 가드 도입 시 가드 자체 테스트 누락 → **L-034 재현** (이번엔 sibling이 이미 테스트 보유 = L-034가 코드로 박혀 있었는데도 첫 구현이 누락).
  - "가드/자동화를 선언했으나 wiring/구현이 없음" → **L-036 재현** (죽은 `--check` + 거짓 키셋 핀 주석, 두 형태로).
  - import.meta.url 기반 직접 실행 가드 → **L-042 재현**.
- 자주 수정된 파일: `scripts/meta/normalize-backlog-schema.mjs` (3 커밋), 테스트 파일 (2 커밋).

## 4. Decisions

- **데이터 정규화 vs 스키마 확장**: 플러그인 스키마는 읽기 전용 upstream + 레포 미vendoring → 정규화 채택. 합리적.
- **화이트리스트 방식**: 미발견 레거시 필드까지 일괄 커버. 단 vendoring 부재로 런타임 파생 불가 → 하드코딩 스냅샷 + `--print-keys` 노출 + 테스트 핀으로 드리프트 자동탐지 보강 (신규 패턴).
- **기술 부채**: `check:backlog-schema`가 npm script로만 배선됨 (CI/pre-commit 미연결). carry로 기록 — 정기 실행 전까지는 수동 가드.

## 5. Lessons (Keep / Improve / Learn / Try)

- **Keep**: 핵심 알고리즘을 impl 즉시 실데이터 dry-run(jsonschema 재검증)으로 검증 → review 전에 currentStep/stepNumber 경계 결함을 조기 포착 (L-041).
- **Improve**: in-task fix 시 **"주석/문서가 약속한 것을 실제 구현했는가"를 같은 커밋에서 자기검증**. 이번엔 주석만 먼저 쓰고 핀 테스트를 빠뜨려 재리뷰 1라운드를 소모 (L-036의 코드주석 변형).
- **Learn**: 회귀 가드의 3종 세트(스크립트 + 단위테스트 + npm 배선)는 sibling 선례가 있어도 자동 적용되지 않는다 — plan 단계에서 명시 체크 필요 (L-034).
- **Try**: vendoring 불가한 외부 스키마의 하드코딩 SSOT 사본은 `--print-keys` 같은 노출 엔드포인트 + 테스트 스냅샷 핀으로 드리프트를 강제 탐지 (신규 L-044).

## Action Items

1. (carry) `check:backlog-schema`를 CI 또는 pre-commit에 연결 — 상시 가드화. *현재 수동 실행.*
2. (process) 회귀 가드 도입 Task의 plan에 "가드 단위 테스트 + npm 배선" 체크 항목 명시 (L-034 강화).
3. (근본) kit 스킬(2.x 잔재)이 비표준 필드를 재기록하면 재발 — `check:backlog-schema` 정기 실행으로 신규 레거시 필드 유입 포착.
