# 회고 — CANDID-057 & CANDID-058 (세션 페어)

> 한 세션에서 연달아 진행한 두 소규모 Task를 묶어 회고. 핵심 교훈은 CANDID-057(공유 함수 반환 형상 변경)에서 나왔다.

## 기본 정보

| 항목 | CANDID-057 | CANDID-058 |
|------|-----------|-----------|
| 제목 | 지원자 대시보드 헤더에 공고 제목 표시 | 홈/메타 카피 포괄화 |
| 타입 / Phase | feature(micro) / 4 | chore(micro) / 3 |
| PR | #156 (squash) | #157 (squash) |
| 머지 라인 | 46 | 26 |
| 스텝 | 1/1 | 1/1 |
| 리뷰 Tier | T2 (architecture+security) | T0 (직접) |
| 차단 이슈 | 0 CRITICAL (1 MAJOR 발견→수정) | 0 |
| 소요(claim→done) | 17:25 → 17:45 (~20분) | 17:52 → 18:02 (~10분) |

## 5축 분석

### 1. Speed
- 두 Task 모두 micro 단일 스텝, 30분 내 plan→impl→review→merge→완료 일괄 진행. 체이닝 정지 없음.
- 병목 없음. CANDID-057은 리뷰에서 MAJOR가 나왔지만 즉시 인라인 수정(별도 fix loop 불필요 — MAJOR는 비차단)으로 흐름 유지.

### 2. Quality
- CRITICAL 0건(양쪽). 첫 리뷰 통과율: 058 100%(T0), 057은 1 MAJOR 지적 → 즉시 해소.
- **두 Task 모두 회귀 가드 테스트를 동반**(057: v1 계약 비누수 테스트, 058: 카피 fs 검사). 작은 변경에도 테스트를 붙인 점이 품질의 핵심.
- typecheck/lint/test 전부 그린 상태로만 PR 생성.

### 3. Patterns
- **공통점: 둘 다 "다중 소비자" 지점을 건드림.**
  - 057: `listApplicantsByPosting`은 운영 대시보드 + **공개 v1 API**가 공유 → 반환에 `posting` 추가가 v1 응답 계약에 누수.
  - 058: 홈 메타데이터(page가 layout을 override하는 구조).
- **반복 좋은 습관**: 변경마다 회귀 가드 테스트 추가.
- **놓친 지점(057)**: 공유 export 함수의 **반환 형상**을 바꾸기 전 *모든 소비자*를 확인하지 않음 → impl/plan 단계에서 놓치고 리뷰(architecture+security 둘 다)가 잡음. 리뷰의 독립 다관점이 실제로 작동한 사례.

### 4. Decisions
- 057 수정 방식: (A) v1 라우트 경계에서 `posting` 제외 vs (B) opt-in 인자 → **A 채택**(계약 소유를 라우트 경계에 둠, 대시보드 반환 타입은 non-optional 유지). 기존 `DEFAULT_PER_PAGE`/`perPage` 계약보존 규율과 정렬.
- 058 테스트: RSC/CSS module import 회피 위해 **fs 텍스트 검사**로 카피 검증 → 안정적·빠름.
- 기술 부채: 없음. 057은 오히려 계약 누수 가드 테스트를 추가해 부채를 줄임.

### 5. Lessons (Keep / Improve / Learn / Try)
- **Keep**: 소규모 변경에도 회귀 가드 테스트 동반. 리뷰 서브에이전트(독립 다관점)가 cross-consumer 누수를 실제로 포착.
- **Improve**: 공유 export 함수의 시그니처/반환 형상 변경 시, plan/impl 단계에서 **`grep`으로 전체 소비자를 먼저 스캔**(특히 공개 API 라우트).
- **Learn**: 이 코드베이스엔 명시적 "v1 API 응답 계약 보존" 규율이 있다(`DEFAULT_PER_PAGE`/`perPage` 분리). 공유 list 서비스 반환에 새 필드를 무조건 추가하면 v1로 누수된다.
- **Try**: 공유 서비스 함수 수정 스텝에 "소비자 스캔" 경량 체크를 습관화.

## Action Items
1. ✅ (완료) 057 v1 계약 누수 → 라우트 경계 strip + 회귀 테스트.
2. 📌 (학습 반영) 공유 함수 반환 형상 변경 전 소비자 전수 스캔 → lessons-learned L-043.
3. 💡 (선택) `_base/checklists`에 "공유 export 함수 반환 변경 시 소비자/공개 API 계약 영향 확인" 항목 추가 검토 — 동일 패턴 재발 시 승격.
