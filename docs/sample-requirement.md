# \# 자사 채용 사이트 - 지원자 프론트엔드(Candidate Web) 상세 요구사항 정의서 (PRD)

# 

# > \*\*Version\*\*: 1.0

# > \*\*Last Updated\*\*: 2026-05-11

# > \*\*Scope\*\*: 본 문서는 전체 채용 플랫폼 중 \*\*지원자(Candidate) 측 프론트엔드 및 이를 직접 지원하는 백엔드 API\*\*에 한정한 상세 요구사항을 정의한다. 어드민(ATS) 영역은 별도 문서에서 다룬다.

# > \*\*목적\*\*: 본 문서는 AI 코딩 도구(Claude Code, Cursor 등)에 그대로 입력하여 즉시 구현 작업에 착수 가능한 수준의 상세도를 가진다. FE / BE / QA가 본 문서만으로 WBS 작성과 API 설계를 시작할 수 있도록 작성되었다.

# 

# \---

# 

# \## 1. 문서 개요

# 

# \### 1.1 대상 시스템 범위

# | 구분 | 포함 | 비고 |

# |---|---|---|

# | 지원자 회원가입/로그인 | ✅ | 이메일 + 소셜(Google, GitHub) |

# | 채용 공고 조회 | ✅ | 목록/상세, 비로그인 열람 허용 |

# | 지원서 작성/임시저장/제출 | ✅ | 파일 업로드 포함 |

# | 마이페이지 | ✅ | 지원 내역, 진행 상황, 결과 |

# | 어드민 백오피스 | ❌ | 별도 문서 |

# | 면접관 평가 시스템 | ❌ | 별도 문서 |

# | Slack 연동 | △ | 어드민 측 발신, 본 문서에서는 트리거 이벤트만 정의 |

# 

# \### 1.2 핵심 사용자(Persona)

# \- \*\*P1. 신규 지원자\*\*: 채용 공고를 탐색하고 처음 지원하는 사용자. 빠른 가입과 직관적인 작성 UX가 핵심.

# \- \*\*P2. 재지원자\*\*: 이전 지원 이력이 있는 사용자. 마이페이지에서 결과를 확인하고 다른 포지션에 재지원.

# \- \*\*P3. 비로그인 탐색자\*\*: 공고만 둘러보고 이탈하거나 SNS로 공유하는 사용자. SEO 및 OG 태그 최적화 대상.

# 

# \### 1.3 용어 정의

# | 용어 | 정의 |

# |---|---|

# | \*\*공고(Job Posting)\*\* | 특정 직군/포지션에 대해 게시된 채용 안내. 모집 기간이 있는 단위. |

# | \*\*지원서(Application)\*\* | 한 지원자가 하나의 공고에 제출한 단일 지원 건. |

# | \*\*임시 저장(Draft)\*\* | 제출 전 작성 중인 지원서 데이터. 1인 1공고당 1건만 존재. |

# | \*\*전형(Stage)\*\* | 서류 → 1차 면접 → 2차 면접 → 처우 협의 → 최종 합격 등 단계. |

# | \*\*전형 상태(Application Status)\*\* | 현재 전형 단계 + 결과(진행/합격/불합격/철회). |

# 

# \---

# 

# \## 2. 사용자 스토리(User Story) 기반 상세 기능 명세

# 

# > \*\*User Story 표준 포맷\*\*: `\[ID] (P:우선순위) 사용자로서 / 나는 \~를 하고 싶다 / 왜냐하면 \~ 때문이다.`

# > \*\*우선순위\*\*: P0(MVP 필수), P1(런칭 필수), P2(런칭 후 개선)

# 

# \---

# 

# \### 2.1 계정 관리 (Account Management)

# 

# \#### US-AUTH-001 (P0) 이메일 회원가입

# > \*\*As a\*\* 신규 지원자, \*\*I want\*\* 이메일/비밀번호로 회원가입할 수 있기를, \*\*so that\*\* 소셜 계정 없이도 지원 절차를 진행할 수 있다.

# 

# \*\*상세 요구사항\*\*

# \- 필수 입력값: 이메일, 비밀번호, 비밀번호 확인, 이름, 약관 동의(이용약관, 개인정보 처리방침)

# \- 선택 입력값: 마케팅 정보 수신 동의

# \- 이메일 형식 검증: RFC 5322 기본 패턴

# \- 비밀번호 규칙: 최소 10자, 영문 대/소문자 + 숫자 + 특수문자 중 3종 이상 조합

# \- 가입 직후 \*\*이메일 인증 메일 발송\*\* → 미인증 상태에서도 로그인 및 공고 조회는 가능하나, \*\*지원서 최종 제출 시점에 이메일 인증 완료가 강제\*\*된다.

# \- 이메일 인증 토큰 유효기간: 24시간, 재발송 가능(60초 쿨다운)

# 

# \*\*Acceptance Criteria (수락 기준)\*\*

# \- \[ ] 동일 이메일 중복 가입 시 명확한 에러 메시지 표시

# \- \[ ] 약관 미동의 시 가입 버튼 비활성화

# \- \[ ] 가입 성공 시 자동 로그인 처리 후 메인 페이지 또는 직전 페이지로 리다이렉트

# \- \[ ] 비밀번호는 BCrypt(strength 12) 해시 저장, 평문/로그/응답 어디에도 노출 금지

# 

# \---

# 

# \#### US-AUTH-002 (P0) 이메일 로그인

# > \*\*As a\*\* 기존 회원, \*\*I want\*\* 이메일/비밀번호로 로그인할 수 있기를, \*\*so that\*\* 내 지원 내역을 관리할 수 있다.

# 

# \*\*상세 요구사항\*\*

# \- 인증 방식: JWT(Access Token 30분) + Refresh Token(14일, HttpOnly Secure Cookie 권장)

# \- "로그인 상태 유지" 옵션: 미체크 시 Refresh Token 만료 1일

# \- 로그인 실패 횟수 제한: 동일 계정 5회 실패 시 \*\*15분간 잠금\*\*(429 응답)

# \- 로그인 실패 시 "이메일 또는 비밀번호가 일치하지 않습니다" — 어느 쪽이 틀렸는지 노출하지 않음(계정 열거 공격 방지)

# 

# \*\*Acceptance Criteria\*\*

# \- \[ ] 로그인 직전 URL이 있는 경우 로그인 후 해당 URL로 복귀

# \- \[ ] 잠금 상태일 때 잠금 해제까지 남은 시간을 명확히 안내

# \- \[ ] Access Token 만료 시 Refresh Token으로 자동 갱신, 갱신 실패 시 로그인 페이지로 리다이렉트

# 

# \---

# 

# \#### US-AUTH-003 (P0) 소셜 로그인 — Google, GitHub

# > \*\*As a\*\* 신규/기존 사용자, \*\*I want\*\* 구글 또는 깃허브 계정으로 간편 로그인할 수 있기를, \*\*so that\*\* 별도 가입 절차 없이 빠르게 지원할 수 있다.

# 

# \*\*상세 요구사항\*\*

# \- 프로토콜: OAuth 2.0 Authorization Code Flow (PKCE 적용 권장)

# \- Spring Boot 측 구현: `spring-boot-starter-oauth2-client`

# \- 최초 로그인 시 \*\*계정 연결(linking) 정책\*\*:

# &#x20; - 동일 이메일이 이미 가입되어 있는 경우 → 기존 계정과 자동 연결하지 않고, \*\*본인 확인 후 명시적 연결\*\*(보안상 권장). MVP 단계에서는 "이미 가입된 이메일입니다. 이메일 로그인 후 마이페이지에서 소셜 연동을 해주세요" 안내로 대체 가능.

# &#x20; - 신규 이메일인 경우 → 자동 가입 처리(이름, 이메일, 프로필 이미지 URL만 수집)

# \- 소셜 계정만으로 가입한 사용자는 \*\*비밀번호 필드가 없는 상태\*\*가 되므로, 이메일 로그인 시도 시 "소셜 계정으로 로그인해주세요" 안내

# 

# \*\*Acceptance Criteria\*\*

# \- \[ ] Google: profile, email scope만 요청

# \- \[ ] GitHub: read:user, user:email scope만 요청

# \- \[ ] 소셜 로그인 콜백 실패(사용자가 거부, 네트워크 오류 등) 시 로그인 페이지로 복귀하고 사용자 친화적 메시지 표시

# \- \[ ] 소셜에서 제공한 이메일이 미인증 상태일 경우 별도 이메일 인증 절차 진행

# 

# \---

# 

# \#### US-AUTH-004 (P1) 비밀번호 재설정

# > \*\*As a\*\* 비밀번호를 잊은 사용자, \*\*I want\*\* 이메일을 통해 비밀번호를 재설정할 수 있기를, \*\*so that\*\* 다시 로그인할 수 있다.

# 

# \*\*상세 요구사항\*\*

# \- 이메일 입력 후 재설정 메일 발송. \*\*존재 여부와 무관하게 동일한 응답 메시지\*\* 노출(계정 열거 방지).

# \- 재설정 토큰 유효기간 30분, 일회용

# \- 재설정 완료 시 모든 기존 세션/리프레시 토큰 무효화

# 

# \---

# 

# \#### US-AUTH-005 (P1) 로그아웃 / 회원 탈퇴

# \*\*로그아웃\*\*

# \- Access Token은 클라이언트에서 제거, Refresh Token은 서버에서 블랙리스트 처리(Redis TTL = Refresh Token 잔여 만료시간)

# 

# \*\*회원 탈퇴\*\*

# \- \*\*제출 완료된 지원서가 있는 경우 처리 정책\*\*:

# &#x20; - 옵션 A (권장): 탈퇴 시 개인정보는 마스킹/익명화하되, 채용 평가 기록은 채용 절차 종료 시까지 보존(개인정보 보호법상 채용 목적 보유 근거)

# &#x20; - 옵션 B: 탈퇴 시 진행 중인 지원서는 자동 철회 처리

# \- \*\*법적 보존 기간\*\*: 채용 종료 후 1년(전자상거래법 등 별도 적용 시 상이) — 회사 법무 검토 필요

# \- 탈퇴는 비밀번호 재확인(소셜의 경우 재인증) 후 진행

# 

# \---

# 

# \### 2.2 채용 공고 (Job Postings)

# 

# \#### US-JOB-001 (P0) 채용 공고 목록 조회

# > \*\*As a\*\* 방문자, \*\*I want\*\* 직군별로 채용 공고 목록을 볼 수 있기를, \*\*so that\*\* 관심 있는 포지션을 빠르게 찾을 수 있다.

# 

# \*\*상세 요구사항\*\*

# \- 비로그인 상태에서도 접근 가능

# \- 필터: 직군(개발/디자인/기획/경영지원/...), 고용형태(정규직/계약직/인턴), 경력(신입/경력/무관)

# \- 정렬: 최신순(기본), 마감 임박순

# \- 페이징: 무한 스크롤 또는 페이지네이션(20건 단위)

# \- 카드형 UI: 포지션명, 직군, 고용형태, 마감일(D-Day), 모집 여부 뱃지

# \- 마감일이 지난 공고는 별도 섹션 또는 흐릿한 처리로 표시(완전 숨김 X — SEO 자산 보존)

# 

# \*\*Acceptance Criteria\*\*

# \- \[ ] URL 쿼리 파라미터로 필터/정렬 상태 유지(공유 가능)

# \- \[ ] 메타 태그(title, description, OG) 동적 생성

# 

# \---

# 

# \#### US-JOB-002 (P0) 채용 공고 상세 조회

# > \*\*As a\*\* 방문자, \*\*I want\*\* 공고의 상세 내용을 볼 수 있기를, \*\*so that\*\* 직무 적합도를 판단하고 지원 여부를 결정할 수 있다.

# 

# \*\*상세 요구사항\*\*

# \- 표시 항목: 포지션명, 직군, 주요 업무, 자격 요건, 우대 사항, 복지, 채용 절차, 모집 기간, 근무지, 담당자 연락처(선택)

# \- "지원하기" CTA 버튼

# &#x20; - 비로그인 시 → 로그인 페이지로 이동(로그인 후 해당 공고 지원 페이지로 자동 복귀)

# &#x20; - 로그인 시 → 지원서 작성 페이지로 이동

# &#x20; - 이미 지원한 공고 → "지원 완료" 비활성 버튼 + "마이페이지에서 확인" 링크

# &#x20; - 임시 저장 있는 경우 → "이어서 작성하기"로 라벨 변경

# &#x20; - 마감된 공고 → "지원 마감" 비활성

# \- 공유 기능: URL 복사, 카카오톡/링크드인 공유(선택)

# \- 본문은 어드민에서 작성된 HTML/Markdown 렌더링 → \*\*XSS 방지를 위해 화이트리스트 기반 sanitizer 필수\*\*

# 

# \---

# 

# \### 2.3 지원서 작성 및 제출 (Application)

# 

# \#### US-APP-001 (P0) 지원서 작성 시작

# > \*\*As a\*\* 로그인한 지원자, \*\*I want\*\* 공고에 지원서 작성을 시작할 수 있기를, \*\*so that\*\* 내 정보를 입력하여 제출할 수 있다.

# 

# \*\*상세 요구사항\*\*

# \- 작성 폼은 \*\*3단계 스텝 UI\*\* 권장:

# &#x20; 1. 기본 인적사항

# &#x20; 2. 이력서 및 포트폴리오

# &#x20; 3. 자기소개 및 추가 질문(공고별 커스텀 질문)

# \- 각 스텝 이동 시 자동 임시 저장

# \- 진행률 인디케이터 표시(33% / 66% / 100%)

# 

# \---

# 

# \#### US-APP-002 (P0) 기본 인적사항 입력

# \*\*필드 정의\*\*

# 

# | 필드 | 타입 | 필수 | 검증 규칙 |

# |---|---|---|---|

# | 이름 | string | ✅ | 한글/영문, 2\~50자 |

# | 이메일 | string | ✅ | 가입 이메일로 자동 채움, 수정 불가 |

# | 연락처 | string | ✅ | 휴대전화 형식(010-XXXX-XXXX), 정규식 검증 |

# | 생년월일 | date | ✅ | 만 14세 이상(개인정보보호법) |

# | 주소 | string | ⬜ | 다음 우편번호 API 연동 권장 |

# | 경력 구분 | enum | ✅ | NEW/EXPERIENCED |

# | 총 경력 개월 수 | number | △ | 경력자 한정 필수 |

# | 최종 학력 | enum | ⬜ | 고졸/전문대졸/학사/석사/박사 |

# 

# \- 휴대폰 본인 인증(나이스/KMC) 도입 여부는 정책 결정 필요 — MVP에서는 자기 신고 기반으로 시작 권장

# \- 지원서 제출 후 인적사항 변경은 \*\*별도 정정 요청\*\* 플로우(US-MY-006)로 분리

# 

# \---

# 

# \#### US-APP-003 (P0) 이력서 파일 첨부

# > \*\*As a\*\* 지원자, \*\*I want\*\* PDF/DOCX 형식의 이력서를 업로드할 수 있기를, \*\*so that\*\* 내 이력을 충실히 전달할 수 있다.

# 

# \*\*상세 요구사항\*\*

# \- 허용 확장자: `.pdf`, `.docx`, `.doc`, `.hwp`, `.hwpx`

# \- 허용 MIME 타입 화이트리스트 검증(확장자만으로 신뢰 X)

# \- 최대 파일 크기: \*\*10MB\*\*

# \- 최대 첨부 개수: 1개(교체 시 기존 파일 즉시 삭제 큐 등록)

# \- 업로드 방식: \*\*Pre-signed URL 방식 권장\*\* (S3/MinIO 직접 업로드 → 서버 부하 감소). 내부망/오프라인 환경 제약이 있다면 multipart/form-data 직접 업로드 + nginx `client\_max\_body\_size` 조정.

# \- 파일명은 서버에서 UUID 기반으로 재명명(원본 파일명은 별도 컬럼 보존)

# \- \*\*악성 파일 검사\*\*: 가능하면 ClamAV 등으로 비동기 스캔, 스캔 완료 전까지 어드민 측 다운로드 불가

# \- 미리보기: PDF에 한해 브라우저 내 임베드 뷰어 제공(P1)

# 

# \*\*Acceptance Criteria\*\*

# \- \[ ] 업로드 진행률 표시, 중단/재시도 가능

# \- \[ ] 동일 지원자가 동시에 여러 탭에서 업로드 시도 시 마지막 업로드만 유효

# \- \[ ] 업로드 실패 시 사용자에게 원인을 명확히 안내(용량 초과/확장자/네트워크)

# 

# \---

# 

# \#### US-APP-004 (P0) 외부 포트폴리오 링크 입력

# > \*\*As a\*\* 지원자, \*\*I want\*\* Notion, GitHub, 블로그 등 외부 링크를 첨부할 수 있기를, \*\*so that\*\* 작업물을 효과적으로 어필할 수 있다.

# 

# \*\*상세 요구사항\*\*

# \- 링크 입력 슬롯: 최대 5개

# \- 각 슬롯 구성: `링크 타입(enum) + URL + 메모(선택)`

# \- 링크 타입: `GITHUB`, `NOTION`, `BLOG`, `LINKEDIN`, `FIGMA`, `ETC`

# \- URL 검증:

# &#x20; - 형식 검증: `https?://` 시작, 도메인 유효성

# &#x20; - 도메인 화이트리스트 검증(권장): GITHUB → `github.com`, NOTION → `notion.so`, `notion.site` 등

# &#x20; - \*\*링크 미리보기(OG 태그) 자동 추출은 P1\*\*: 서버 측에서 fetch 시 SSRF 취약점에 주의(내부망 IP 차단, 리다이렉트 제한, 타임아웃 3초)

# \- 비공개 노션 페이지 등은 어드민에서 열람 불가하므로 \*\*"공개 설정 확인" 안내 문구\*\* 노출

# 

# \---

# 

# \#### US-APP-005 (P0) 임시 저장 (Draft)

# > \*\*As a\*\* 지원자, \*\*I want\*\* 작성 중 브라우저를 닫아도 내용이 보존되기를, \*\*so that\*\* 나중에 이어서 작성할 수 있다.

# 

# \*\*상세 요구사항\*\*

# \- \*\*저장 트리거\*\*:

# &#x20; 1. \*\*자동 저장\*\*: 입력 후 3초 디바운스(debounce) 또는 30초 주기(둘 중 빠른 쪽)

# &#x20; 2. \*\*수동 저장\*\*: 화면 우측 상단 "임시 저장" 버튼

# &#x20; 3. \*\*스텝 이동 시 강제 저장\*\*

# &#x20; 4. \*\*페이지 이탈 감지\*\*: `beforeunload` 이벤트로 미저장 시 경고

# \- \*\*저장 단위\*\*: 1 사용자 × 1 공고 = 1 Draft (`UNIQUE(user\_id, job\_posting\_id)`)

# \- \*\*저장 데이터 범위\*\*: 입력된 모든 텍스트 필드, 업로드 완료된 파일 메타데이터, 포트폴리오 링크

# \- \*\*파일은 임시 저장 시점에도 영구 저장됨\*\* — 제출 없이 폐기되는 경우 정기 배치(예: 30일 이상 미제출 Draft 자동 삭제)

# \- 저장 직후 토스트 알림 "임시 저장됨 · 오후 2:35"

# 

# \*\*Acceptance Criteria\*\*

# \- \[ ] 마이페이지에서 "작성 중인 지원서" 섹션에서 임시 저장 건 확인 가능

# \- \[ ] 임시 저장된 데이터로 작성 페이지 진입 시 모든 필드 자동 복원

# \- \[ ] 동일 공고를 두 개 탭에서 동시 작성 시 마지막 저장이 우선(낙관적 락 또는 last-write-wins, 사용자에게 충돌 안내)

# 

# \---

# 

# \#### US-APP-006 (P0) 지원서 최종 제출

# > \*\*As a\*\* 작성을 마친 지원자, \*\*I want\*\* 지원서를 최종 제출할 수 있기를, \*\*so that\*\* 채용 절차가 시작된다.

# 

# \*\*상세 요구사항\*\*

# \- 제출 전 필수 검증:

# &#x20; - 모든 필수 필드 입력 완료

# &#x20; - 이력서 파일 1개 이상 업로드

# &#x20; - 이메일 인증 완료

# &#x20; - 개인정보 수집·이용 동의(제출 직전 별도 동의)

# \- 제출 직전 \*\*최종 확인 모달\*\*: 입력 내용 미리보기, "수정" / "제출" 버튼

# \- 제출 후:

# &#x20; - 해당 Draft → Application으로 전환(또는 Draft 삭제 + Application 신규 생성)

# &#x20; - 동일 공고 재지원 불가(추후 정정 요청만 가능)

# &#x20; - 제출 완료 페이지 표시: 지원 번호, 다음 단계 안내, "마이페이지로 이동" / "다른 공고 보기" CTA

# &#x20; - 확인 이메일 자동 발송(템플릿: 지원자명, 공고명, 지원 번호, 진행 상황 확인 링크)

# &#x20; - \*\*Slack 알림 이벤트 발행\*\*(어드민 측에서 소비) — 본 문서 범위 외이나 트리거 명세는 4.x 참조

# 

# \*\*Acceptance Criteria\*\*

# \- \[ ] 마감일 이후 제출 시도 시 명확히 차단

# \- \[ ] 중복 제출 방지: 멱등성 키(idempotency key) 또는 DB 유니크 제약(`UNIQUE(user\_id, job\_posting\_id) WHERE status != 'DRAFT'`)

# \- \[ ] 제출 처리 중 네트워크 단절 시 클라이언트 재시도, 서버는 멱등 처리

# 

# \---

# 

# \### 2.4 마이페이지 (My Page)

# 

# \#### US-MY-001 (P0) 지원 내역 리스트 조회

# > \*\*As a\*\* 로그인 사용자, \*\*I want\*\* 내가 지원한 공고 목록을 한눈에 볼 수 있기를, \*\*so that\*\* 진행 상황을 추적할 수 있다.

# 

# \*\*상세 요구사항\*\*

# \- 섹션 구분:

# &#x20; 1. \*\*작성 중(Draft)\*\*: 임시 저장 건, "이어서 작성" 버튼

# &#x20; 2. \*\*진행 중\*\*: 제출 완료, 전형 진행 상태 표시(서류 검토 중 / 1차 면접 / 최종 합격 등)

# &#x20; 3. \*\*종료\*\*: 최종 합격, 불합격, 지원 철회

# \- 각 카드 표시: 공고명, 제출일, 현재 상태, 상태 변경일

# \- 정렬: 상태 변경일 최신순(기본)

# 

# \---

# 

# \#### US-MY-002 (P0) 지원 상세 및 전형 진행 상황 조회

# > \*\*As a\*\* 지원자, \*\*I want\*\* 내 지원 건의 단계별 진행 상황을 보고 싶다, \*\*so that\*\* 다음 단계를 준비할 수 있다.

# 

# \*\*상세 요구사항\*\*

# \- 타임라인 UI: 단계별 시작/완료 시각 표시

# &#x20; - 예: `서류 접수 (2026-05-01) → 서류 합격 (2026-05-05) → 1차 면접 예정 (2026-05-12 14:00)`

# \- 면접 일정이 잡힌 경우: 일시, 장소(또는 화상 회의 링크), 면접관 안내(이름 노출 여부는 정책 결정), 캘린더(.ics) 다운로드 버튼

# \- 결과 통지: 합격/불합격 별 안내 문구, 처우 협의 단계 시 별도 안내

# \- \*\*점수/평가 코멘트는 절대 노출하지 않음\*\*(내부용)

# 

# \---

# 

# \#### US-MY-003 (P1) 지원 철회

# > \*\*As a\*\* 지원자, \*\*I want\*\* 진행 중인 지원을 철회할 수 있기를, \*\*so that\*\* 마음이 바뀌었을 때 정중히 의사 표시할 수 있다.

# 

# \*\*상세 요구사항\*\*

# \- 철회 사유(선택 입력) 수집

# \- 철회 후 동일 공고 재지원: \*\*모집 기간 내 1회 허용\*\*(정책 결정 필요) 또는 불가

# \- 철회 시 어드민 측 Slack 알림 발송

# 

# \---

# 

# \#### US-MY-004 (P1) 프로필 정보 수정

# \- 수정 가능 항목: 이름, 연락처, 비밀번호

# \- 이메일 변경: P2(별도 인증 플로우 필요)

# \- 소셜 계정 연결 추가/해제

# 

# \---

# 

# \## 3. 데이터베이스 모델링 (개념적 데이터 모델)

# 

# \### 3.1 핵심 도메인 식별

# 

# | 도메인 | 역할 | 본 문서 범위 |

# |---|---|---|

# | \*\*User\*\* | 지원자 계정 정보 | ✅ |

# | \*\*AuthProvider\*\* | 소셜 로그인 연동 정보(1:N) | ✅ |

# | \*\*EmailVerification\*\* | 이메일 인증 토큰 | ✅ |

# | \*\*PasswordResetToken\*\* | 비밀번호 재설정 토큰 | ✅ |

# | \*\*JobCategory\*\* | 직군 분류 | ✅ (조회) |

# | \*\*JobPosting\*\* | 채용 공고 | ✅ (조회) |

# | \*\*JobPostingQuestion\*\* | 공고별 커스텀 질문 | ✅ (조회) |

# | \*\*Application\*\* | 제출된 지원서 | ✅ |

# | \*\*ApplicationDraft\*\* | 임시 저장 지원서 | ✅ |

# | \*\*ApplicationAnswer\*\* | 커스텀 질문 응답 | ✅ |

# | \*\*ResumeFile\*\* | 이력서 파일 메타데이터 | ✅ |

# | \*\*PortfolioLink\*\* | 외부 포트폴리오 링크 | ✅ |

# | \*\*ApplicationStatusHistory\*\* | 전형 상태 변경 이력 | ✅ (조회) |

# | \*\*InterviewSchedule\*\* | 면접 일정 | ✅ (조회) |

# | \*\*AuditLog\*\* | 감사 로그 | ✅ |

# 

# \### 3.2 개념적 ERD (Mermaid)

# 

# ```mermaid

# erDiagram

# &#x20;   USER ||--o{ AUTH\_PROVIDER : "has"

# &#x20;   USER ||--o{ APPLICATION : "submits"

# &#x20;   USER ||--o{ APPLICATION\_DRAFT : "drafts"

# &#x20;   USER ||--o{ EMAIL\_VERIFICATION : "requests"

# &#x20;   USER ||--o{ PASSWORD\_RESET\_TOKEN : "requests"

# 

# &#x20;   JOB\_CATEGORY ||--o{ JOB\_POSTING : "categorizes"

# &#x20;   JOB\_POSTING ||--o{ JOB\_POSTING\_QUESTION : "has"

# &#x20;   JOB\_POSTING ||--o{ APPLICATION : "receives"

# &#x20;   JOB\_POSTING ||--o{ APPLICATION\_DRAFT : "drafted\_for"

# 

# &#x20;   APPLICATION ||--|| RESUME\_FILE : "has"

# &#x20;   APPLICATION ||--o{ PORTFOLIO\_LINK : "includes"

# &#x20;   APPLICATION ||--o{ APPLICATION\_ANSWER : "answers"

# &#x20;   APPLICATION ||--o{ APPLICATION\_STATUS\_HISTORY : "tracks"

# &#x20;   APPLICATION ||--o{ INTERVIEW\_SCHEDULE : "scheduled"

# 

# &#x20;   APPLICATION\_DRAFT ||--o| RESUME\_FILE : "has"

# &#x20;   APPLICATION\_DRAFT ||--o{ PORTFOLIO\_LINK : "includes"

# &#x20;   APPLICATION\_DRAFT ||--o{ APPLICATION\_ANSWER : "answers"

# 

# &#x20;   JOB\_POSTING\_QUESTION ||--o{ APPLICATION\_ANSWER : "answered\_by"

# ```

# 

# \### 3.3 주요 엔티티 상세 (지원자 측 한정)

# 

# \#### 3.3.1 `users`

# | 컬럼 | 타입 | 제약 | 설명 |

# |---|---|---|---|

# | id | BIGINT | PK, AUTO | |

# | email | VARCHAR(255) | UNIQUE, NOT NULL | 소문자 정규화 저장 |

# | password\_hash | VARCHAR(255) | NULL 허용 | 소셜 전용 계정 NULL |

# | name | VARCHAR(100) | NOT NULL | |

# | phone | VARCHAR(20) | NULL | 암호화 저장(개인정보) |

# | birth\_date | DATE | NULL | 암호화 또는 마스킹 |

# | email\_verified\_at | TIMESTAMP | NULL | |

# | status | VARCHAR(20) | NOT NULL | ACTIVE / LOCKED / WITHDRAWN |

# | failed\_login\_count | INT | DEFAULT 0 | |

# | locked\_until | TIMESTAMP | NULL | |

# | created\_at, updated\_at | TIMESTAMP | NOT NULL | |

# | withdrawn\_at | TIMESTAMP | NULL | 탈퇴 시각 |

# 

# \*\*인덱스\*\*: `idx\_users\_email`, `idx\_users\_status`

# 

# \#### 3.3.2 `auth\_providers`

# | 컬럼 | 타입 | 제약 | 설명 |

# |---|---|---|---|

# | id | BIGINT | PK | |

# | user\_id | BIGINT | FK | |

# | provider | VARCHAR(20) | NOT NULL | GOOGLE / GITHUB |

# | provider\_user\_id | VARCHAR(255) | NOT NULL | OAuth subject |

# | profile\_image\_url | VARCHAR(500) | NULL | |

# | linked\_at | TIMESTAMP | NOT NULL | |

# 

# \*\*제약\*\*: `UNIQUE(provider, provider\_user\_id)`, `UNIQUE(user\_id, provider)`

# 

# \#### 3.3.3 `job\_postings` (조회 전용 — 어드민에서 작성)

# | 컬럼 | 타입 | 설명 |

# |---|---|---|

# | id | BIGINT | PK |

# | title | VARCHAR(200) | 포지션명 |

# | job\_category\_id | BIGINT | FK |

# | employment\_type | VARCHAR(20) | FULL\_TIME / CONTRACT / INTERN |

# | career\_level | VARCHAR(20) | NEW / EXPERIENCED / ANY |

# | content\_html | TEXT | sanitized HTML |

# | opens\_at | TIMESTAMP | |

# | closes\_at | TIMESTAMP | NULL = 상시 |

# | status | VARCHAR(20) | DRAFT / OPEN / CLOSED |

# | view\_count | BIGINT | DEFAULT 0 |

# | created\_at, updated\_at | TIMESTAMP | |

# 

# \*\*인덱스\*\*: `idx\_job\_postings\_status\_closes\_at`, `idx\_job\_postings\_category`

# 

# \#### 3.3.4 `applications`

# | 컬럼 | 타입 | 설명 |

# |---|---|---|

# | id | BIGINT | PK |

# | application\_number | VARCHAR(20) | UNIQUE, 사용자 노출용 (`A-202605-00123`) |

# | user\_id | BIGINT | FK |

# | job\_posting\_id | BIGINT | FK |

# | current\_stage | VARCHAR(30) | SUBMITTED / DOC\_REVIEW / INTERVIEW\_1 / ... / OFFER / HIRED |

# | result | VARCHAR(20) | IN\_PROGRESS / PASSED / FAILED / WITHDRAWN |

# | submitted\_at | TIMESTAMP | NOT NULL |

# | withdrawn\_at | TIMESTAMP | NULL |

# | created\_at, updated\_at | TIMESTAMP | |

# 

# \*\*제약\*\*:

# \- `UNIQUE(user\_id, job\_posting\_id)` — 1인 1공고 1회 제출

# \- 단, 철회 후 재지원 허용 정책 적용 시 부분 인덱스 또는 별도 컬럼(`is\_active`) 활용

# 

# \#### 3.3.5 `application\_drafts`

# | 컬럼 | 타입 | 설명 |

# |---|---|---|

# | id | BIGINT | PK |

# | user\_id | BIGINT | FK |

# | job\_posting\_id | BIGINT | FK |

# | payload\_json | JSON | 작성 중 데이터 직렬화 |

# | last\_saved\_at | TIMESTAMP | |

# | version | INT | 낙관적 락 |

# 

# \*\*제약\*\*: `UNIQUE(user\_id, job\_posting\_id)`

# 

# > \*\*설계 노트\*\*: JSON 컬럼으로 통합 저장하면 스키마 변경에 유연하나 검색이 어렵다. 본 도메인은 마이페이지에서만 단순 조회되므로 JSON으로 충분. 다만 이력서 파일은 외부 저장소(S3 등)에 저장되므로 메타데이터만 보관.

# 

# \#### 3.3.6 `resume\_files`

# | 컬럼 | 타입 | 설명 |

# |---|---|---|

# | id | BIGINT | PK |

# | owner\_user\_id | BIGINT | FK |

# | application\_id | BIGINT | FK (NULL 가능 — Draft 단계) |

# | draft\_id | BIGINT | FK (NULL 가능 — 제출 후) |

# | original\_filename | VARCHAR(255) | |

# | stored\_path | VARCHAR(500) | S3 키 또는 내부 경로 |

# | content\_type | VARCHAR(100) | |

# | file\_size | BIGINT | bytes |

# | checksum\_sha256 | VARCHAR(64) | 무결성 검증 |

# | virus\_scan\_status | VARCHAR(20) | PENDING / CLEAN / INFECTED |

# | uploaded\_at | TIMESTAMP | |

# 

# \#### 3.3.7 `portfolio\_links`

# | 컬럼 | 타입 | 설명 |

# |---|---|---|

# | id | BIGINT | PK |

# | application\_id / draft\_id | BIGINT | XOR 관계 |

# | link\_type | VARCHAR(20) | GITHUB / NOTION / BLOG / LINKEDIN / FIGMA / ETC |

# | url | VARCHAR(1000) | |

# | memo | VARCHAR(500) | NULL |

# | sort\_order | INT | |

# 

# \#### 3.3.8 `application\_status\_history` (조회 전용)

# | 컬럼 | 타입 | 설명 |

# |---|---|---|

# | id | BIGINT | PK |

# | application\_id | BIGINT | FK |

# | from\_stage | VARCHAR(30) | |

# | to\_stage | VARCHAR(30) | |

# | changed\_by\_user\_id | BIGINT | 어드민 ID, 시스템 변경은 NULL |

# | changed\_at | TIMESTAMP | |

# | visible\_to\_candidate | BOOLEAN | DEFAULT TRUE — 일부 내부 이력은 미노출 |

# 

# \#### 3.3.9 `interview\_schedules` (조회 전용)

# | 컬럼 | 타입 | 설명 |

# |---|---|---|

# | id | BIGINT | PK |

# | application\_id | BIGINT | FK |

# | stage | VARCHAR(30) | INTERVIEW\_1 / INTERVIEW\_2 |

# | scheduled\_at | TIMESTAMP | |

# | location\_or\_url | VARCHAR(500) | 오프라인 주소 또는 화상 링크 |

# | status | VARCHAR(20) | SCHEDULED / DONE / CANCELLED |

# 

# \### 3.4 인덱스 및 성능 가이드

# \- \*\*마이페이지 조회 쿼리\*\* 최적화: `applications(user\_id, submitted\_at DESC)` 복합 인덱스

# \- \*\*공고 목록\*\*: `job\_postings(status, opens\_at, closes\_at)`

# \- \*\*상태 이력 조회\*\*: `application\_status\_history(application\_id, changed\_at DESC)`

# \- 대용량 트래픽 예상 시 공고 목록은 캐시(Redis, TTL 5분) 적용

# 

# \### 3.5 감사 및 개인정보 보호 설계

# \- `audit\_logs` 테이블: 로그인, 지원서 제출, 개인정보 조회 등의 행위 기록 (BE에서 AOP로 일괄 처리)

# \- 개인정보 컬럼(`phone`, `birth\_date`)은 \*\*AES-256-GCM 컬럼 암호화\*\* 권장

# \- 키 관리: HSM/KMS 또는 별도 키 저장소(내부망 환경 고려)

# 

# \---

# 

# \## 4. 예외 처리 정책 및 비즈니스 규칙

# 

# \### 4.1 공통 예외 처리 정책

# 

# \#### 4.1.1 HTTP 상태 코드 표준

# | 상태 | 사용 시점 |

# |---|---|

# | 200 OK | 정상 조회/처리 |

# | 201 Created | 리소스 생성(가입, 지원서 제출) |

# | 204 No Content | 삭제, 변경 후 본문 없음 |

# | 400 Bad Request | 입력값 검증 실패 |

# | 401 Unauthorized | 인증 토큰 없음/만료 |

# | 403 Forbidden | 권한 없음(본인 지원서 외 접근 등) |

# | 404 Not Found | 리소스 없음 |

# | 409 Conflict | 중복 가입, 중복 지원, Draft 충돌 |

# | 422 Unprocessable Entity | 비즈니스 규칙 위반(예: 마감된 공고 지원) |

# | 429 Too Many Requests | Rate limit, 로그인 잠금 |

# | 500 Internal Server Error | 서버 내부 오류 |

# | 503 Service Unavailable | 점검 모드, 외부 의존성 장애 |

# 

# \#### 4.1.2 에러 응답 표준 포맷

# ```json

# {

# &#x20; "timestamp": "2026-05-11T14:23:01+09:00",

# &#x20; "status": 422,

# &#x20; "code": "APPLICATION\_DEADLINE\_PASSED",

# &#x20; "message": "지원 마감일이 지난 공고입니다.",

# &#x20; "path": "/api/v1/applications",

# &#x20; "traceId": "a1b2c3d4-...",

# &#x20; "details": \[

# &#x20;   { "field": "jobPostingId", "reason": "closed\_at < now" }

# &#x20; ]

# }

# ```

# \- `code`는 클라이언트가 분기 처리할 수 있도록 \*\*불변 문자열 상수\*\*로 정의

# \- `message`는 사용자 친화적 한국어, `details`는 디버깅용

# \- 운영 환경에서는 스택 트레이스 미노출

# 

# \#### 4.1.3 에러 코드 체계(예시)

# | 도메인 | 접두어 | 예시 |

# |---|---|---|

# | 인증 | `AUTH\_` | `AUTH\_INVALID\_CREDENTIALS`, `AUTH\_ACCOUNT\_LOCKED`, `AUTH\_EMAIL\_NOT\_VERIFIED` |

# | 사용자 | `USER\_` | `USER\_EMAIL\_DUPLICATED`, `USER\_NOT\_FOUND` |

# | 공고 | `JOB\_` | `JOB\_NOT\_FOUND`, `JOB\_NOT\_OPEN`, `JOB\_CLOSED` |

# | 지원 | `APP\_` | `APP\_ALREADY\_SUBMITTED`, `APP\_DEADLINE\_PASSED`, `APP\_DRAFT\_CONFLICT` |

# | 파일 | `FILE\_` | `FILE\_SIZE\_EXCEEDED`, `FILE\_TYPE\_NOT\_ALLOWED`, `FILE\_UPLOAD\_FAILED` |

# | 시스템 | `SYS\_` | `SYS\_INTERNAL\_ERROR`, `SYS\_DEPENDENCY\_UNAVAILABLE` |

# 

# \#### 4.1.4 Spring Boot 전역 예외 처리

# \- `@RestControllerAdvice` + `@ExceptionHandler` 패턴

# \- 도메인 예외는 `BusinessException(ErrorCode)` 상속 구조로 통일

# \- 검증 실패(`MethodArgumentNotValidException`, `ConstraintViolationException`)는 공통 핸들러에서 `details` 배열로 변환

# 

# \---

# 

# \### 4.2 도메인별 비즈니스 규칙

# 

# \#### 4.2.1 인증/계정 규칙

# | ID | 규칙 |

# |---|---|

# | BR-AUTH-01 | 이메일은 가입 시점에 소문자 정규화하여 저장. 비교 시에도 소문자. |

# | BR-AUTH-02 | 비밀번호는 BCrypt(strength 12) 외 어떠한 형태로도 저장/로깅 금지. |

# | BR-AUTH-03 | 로그인 5회 연속 실패 시 15분 잠금. 성공 시 카운터 초기화. |

# | BR-AUTH-04 | 이메일 미인증 사용자는 로그인/공고 조회 가능, \*\*지원서 제출 시점에 차단\*\*. |

# | BR-AUTH-05 | 비밀번호 변경/재설정 시 모든 Refresh Token 즉시 무효화. |

# | BR-AUTH-06 | 소셜 가입 시 이메일이 동일한 기존 계정이 있으면 자동 연결하지 않고 안내. |

# | BR-AUTH-07 | JWT는 서명 알고리즘 RS256 또는 HS512 사용. 시크릿은 환경 변수/Vault에서 주입. |

# 

# \#### 4.2.2 공고 조회 규칙

# | ID | 규칙 |

# |---|---|

# | BR-JOB-01 | `status = OPEN` AND `opens\_at <= now <= closes\_at` 인 공고만 "모집 중"으로 분류. |

# | BR-JOB-02 | 마감된 공고도 URL 직접 접근 시 상세 페이지 노출(이력/SEO 보존), "지원하기" 버튼만 비활성. |

# | BR-JOB-03 | `status = DRAFT` 공고는 어떠한 비인증 경로로도 노출 금지. |

# | BR-JOB-04 | 공고 본문은 저장 시 sanitize, 조회 시에도 한 번 더 sanitize(이중 방어). |

# 

# \#### 4.2.3 지원서 작성/제출 규칙

# | ID | 규칙 |

# |---|---|

# | BR-APP-01 | 동일 사용자 × 동일 공고에 대해 \*\*활성 지원서\*\*(`result != WITHDRAWN`)는 1건만 존재. |

# | BR-APP-02 | 임시 저장(Draft)은 사용자×공고당 1건. 신규 작성 진입 시 기존 Draft가 있으면 자동 로드. |

# | BR-APP-03 | 제출 시점에 `closes\_at < now` 인 공고는 422 에러(`APP\_DEADLINE\_PASSED`). |

# | BR-APP-04 | 제출 직전에 다시 한 번 마감 시각 검증(작성 중 마감되는 케이스 방어). |

# | BR-APP-05 | 제출 성공 시 Draft는 삭제. Application의 `application\_number`는 `A-YYYYMM-NNNNN` 형식으로 발급. |

# | BR-APP-06 | 멱등성: 클라이언트는 제출 요청 시 `Idempotency-Key` 헤더 전송, 서버는 24시간 동안 동일 키로 중복 응답. |

# | BR-APP-07 | 자동 임시 저장 실패는 사용자에게 비차단적(non-blocking) 토스트로만 알림 — 입력은 계속 가능. |

# | BR-APP-08 | 면접 일정 확정/결과 변경 등 어드민 측 상태 변경 시 본인의 마이페이지에 반영. 알림 채널(이메일/푸시)은 P1. |

# 

# \#### 4.2.4 파일 업로드 규칙

# | ID | 규칙 |

# |---|---|

# | BR-FILE-01 | 확장자 + MIME 타입 화이트리스트 \*\*이중 검증\*\*. |

# | BR-FILE-02 | 최대 10MB 초과 시 클라이언트 사전 차단 + 서버 재검증. |

# | BR-FILE-03 | 파일명에 경로 문자(`/`, `\\`, `..`) 포함 시 거부. 서버 저장 시 UUID 재명명. |

# | BR-FILE-04 | 업로드 직후 비동기 바이러스 스캔 큐 등록. `INFECTED` 시 자동 삭제 + 사용자 알림. |

# | BR-FILE-05 | Pre-signed URL 사용 시 유효기간 5분, 단일 PUT 한정. |

# | BR-FILE-06 | 30일 이상 미제출 Draft의 파일은 야간 배치로 삭제. |

# | BR-FILE-07 | 다운로드 권한: 본인 또는 해당 공고에 권한 있는 어드민 한정. |

# 

# \#### 4.2.5 포트폴리오 링크 규칙

# | ID | 규칙 |

# |---|---|

# | BR-LINK-01 | URL은 반드시 `https://`로 시작(또는 `http://` 허용 여부 정책 결정). |

# | BR-LINK-02 | OG 태그 자동 추출 시 사설망/내부 IP(`10.`, `172.16\~31.`, `192.168.`, `127.`, `169.254.`) 차단(SSRF). |

# | BR-LINK-03 | OG fetch는 최대 3초, 5xx 응답 시 즉시 포기, 응답 본문 1MB 제한. |

# | BR-LINK-04 | 링크 최대 5개 초과 입력 시 클라이언트/서버 양측 거부. |

# 

# \#### 4.2.6 개인정보 보호 규칙

# | ID | 규칙 |

# |---|---|

# | BR-PII-01 | `phone`, `birth\_date`는 AES-256-GCM 암호화. 응답 시 마스킹(`010-\*\*\*\*-1234`). |

# | BR-PII-02 | 로그/Slack/이메일 본문 어디에도 비밀번호/주민번호/카드번호 노출 금지. 로깅 마스킹 필터 적용. |

# | BR-PII-03 | 회원 탈퇴 시: 진행 중 지원이 있으면 채용 종료 시까지 익명화 보존, 없으면 즉시 삭제. |

# | BR-PII-04 | 채용 종료 후 보존 기간 만료 데이터는 자동 파기 배치 운영. |

# | BR-PII-05 | 만 14세 미만 가입 차단. `birth\_date` 기준 검증. |

# 

# \#### 4.2.7 보안 정책

# | ID | 규칙 |

# |---|---|

# | BR-SEC-01 | 모든 API는 HTTPS 한정. HTTP 접근 시 308 리다이렉트. |

# | BR-SEC-02 | CSRF 방어: SameSite=Lax/Strict 쿠키 + Origin 검증. |

# | BR-SEC-03 | CORS: 운영 도메인 화이트리스트, 와일드카드 금지. |

# | BR-SEC-04 | Rate Limit: 로그인 10회/분/IP, 회원가입 5회/시간/IP, 파일 업로드 30회/시간/사용자. |

# | BR-SEC-05 | XSS 방어: 사용자 입력 출력 시 escape, 어드민 작성 HTML은 sanitizer(OWASP Java HTML Sanitizer) 통과. |

# | BR-SEC-06 | SQL Injection 방어: JPA/MyBatis 파라미터 바인딩 강제, 동적 쿼리 시 화이트리스트 컬럼명. |

# | BR-SEC-07 | 인증/인가 실패 응답에 내부 구조 노출 금지. |

# 

# \#### 4.2.8 트랜잭션 정책

# | ID | 규칙 |

# |---|---|

# | BR-TX-01 | 지원서 제출은 단일 트랜잭션(Application 생성 + Draft 삭제 + 이력 생성). |

# | BR-TX-02 | Slack 알림 발송 등 외부 호출은 트랜잭션 외부에서 \*\*이벤트 발행(스프링 이벤트 또는 RabbitMQ)\*\* 후 비동기 처리. |

# | BR-TX-03 | 외부 호출 실패가 사용자 응답을 차단하지 않음. 재시도는 큐 기반(지수 백오프, 최대 5회). |

# | BR-TX-04 | 임시 저장은 `@Transactional` + 낙관적 락(`@Version`)로 동시성 처리. |

# 

# \---

# 

# \### 4.3 비기능 요구사항 (NFR)

# 

# | 항목 | 목표 |

# |---|---|

# | 응답 시간 | 공고 목록/상세 P95 < 300ms, 지원서 제출 P95 < 800ms |

# | 동시 사용자 | 일반 1k DAU, 채용 시즌 피크 10k 동시 접속 대응 |

# | 가용성 | 99.5% (월 약 3.6시간 다운타임 허용) |

# | 모바일 반응형 | 320px \~ 1920px 대응, iOS Safari 15+ / Chrome 90+ |

# | 접근성 | WCAG 2.1 AA 준수(폼 라벨, 키보드 네비게이션, 대비비) |

# | SEO | 공고 페이지 SSR/SSG, OG 태그, structured data(`JobPosting` schema.org) |

# | i18n | 1단계 한국어 고정. 영어 대응은 P2(키 기반 메시지 분리). |

# | 관측성 | 분산 추적(traceId) 전 구간 전파, 주요 비즈니스 이벤트 메트릭 노출(Prometheus) |

# 

# \---

# 

# \### 4.4 API 설계 가이드 (대표 엔드포인트)

# 

# > 전체 명세는 OpenAPI(Swagger)로 별도 관리. 본 문서는 핵심만 제시.

# 

# | Method | Path | 설명 | 인증 |

# |---|---|---|---|

# | POST | `/api/v1/auth/signup` | 이메일 가입 | ✗ |

# | POST | `/api/v1/auth/login` | 이메일 로그인 | ✗ |

# | POST | `/api/v1/auth/social/{provider}/callback` | 소셜 로그인 콜백 | ✗ |

# | POST | `/api/v1/auth/refresh` | 토큰 갱신 | Refresh |

# | POST | `/api/v1/auth/logout` | 로그아웃 | ✓ |

# | POST | `/api/v1/auth/password/reset-request` | 재설정 메일 발송 | ✗ |

# | POST | `/api/v1/auth/password/reset` | 재설정 토큰으로 변경 | ✗ |

# | GET | `/api/v1/job-postings` | 공고 목록 | ✗ |

# | GET | `/api/v1/job-postings/{id}` | 공고 상세 | ✗ |

# | GET | `/api/v1/applications/drafts/{jobPostingId}` | Draft 조회 | ✓ |

# | PUT | `/api/v1/applications/drafts/{jobPostingId}` | Draft 저장(upsert) | ✓ |

# | DELETE | `/api/v1/applications/drafts/{jobPostingId}` | Draft 삭제 | ✓ |

# | POST | `/api/v1/applications` | 지원서 제출 | ✓, Idempotency-Key |

# | GET | `/api/v1/applications/me` | 내 지원 내역 | ✓ |

# | GET | `/api/v1/applications/{id}` | 지원 상세 | ✓(본인) |

# | POST | `/api/v1/applications/{id}/withdraw` | 지원 철회 | ✓(본인) |

# | POST | `/api/v1/files/resume/presign` | 이력서 업로드 Pre-signed URL | ✓ |

# | POST | `/api/v1/files/resume/confirm` | 업로드 완료 통지(메타 등록) | ✓ |

# | GET | `/api/v1/users/me` | 내 프로필 | ✓ |

# | PATCH | `/api/v1/users/me` | 프로필 수정 | ✓ |

# 

# \### 4.5 이벤트(Event) 정의 — 어드민/알림 측 소비 대상

# | 이벤트명 | 발행 시점 | 페이로드 핵심 |

# |---|---|---|

# | `ApplicationSubmittedEvent` | 지원서 제출 성공 | applicationId, userId, jobPostingId, submittedAt |

# | `ApplicationWithdrawnEvent` | 지원 철회 | applicationId, reason |

# | `UserSignedUpEvent` | 가입 완료 | userId, signupChannel |

# | `ResumeFileScannedEvent` | 바이러스 스캔 완료 | fileId, result |

# 

# > 이벤트는 Spring `ApplicationEventPublisher` → RabbitMQ 브릿지 패턴 권장. 트랜잭션 커밋 후 발행(`@TransactionalEventListener(phase = AFTER\_COMMIT)`).

# 

# \---

# 

# \## 5. 화면 및 라우팅 구성 (참고)

# 

# | 라우트 | 화면 | 인증 |

# |---|---|---|

# | `/` | 메인(주요 공고 노출) | ✗ |

# | `/jobs` | 공고 목록 | ✗ |

# | `/jobs/:id` | 공고 상세 | ✗ |

# | `/jobs/:id/apply` | 지원서 작성 | ✓ |

# | `/login`, `/signup` | 인증 | ✗ |

# | `/password/reset` | 비밀번호 재설정 | ✗ |

# | `/me` | 마이페이지 대시보드 | ✓ |

# | `/me/applications/:id` | 지원 상세 | ✓ |

# | `/me/profile` | 프로필 관리 | ✓ |

# | `/oauth/callback/:provider` | OAuth 콜백 | ✗ |

# 

# \---

# 

# \## 6. QA를 위한 핵심 테스트 시나리오 (요약)

# 

# | 카테고리 | 시나리오 |

# |---|---|

# | 인증 | 이메일 가입 → 인증 메일 → 인증 완료 → 지원 제출 가능 / 미인증 상태에서 제출 차단 |

# | 인증 | 로그인 5회 실패 → 잠금 → 15분 후 해제 |

# | 소셜 | 동일 이메일 기존 계정 존재 시 자동 연결 차단 |

# | 공고 | 마감 1초 전 제출 성공, 마감 1초 후 제출 422 |

# | 지원 | 동일 공고 중복 제출 시 409 |

# | Draft | 두 탭 동시 편집 시 마지막 저장 우선, 사용자 안내 표시 |

# | 파일 | 11MB 파일 → 거부 / 확장자 위조(.exe → .pdf 변경) → MIME 검증으로 거부 |

# | 파일 | 업로드 중 네트워크 끊김 → 재개 또는 재시도 |

# | 보안 | XSS 페이로드 입력 → 출력 시 escape 확인 |

# | 보안 | 타인의 `applicationId`로 조회 시도 → 403 |

# | 성능 | 공고 목록 1000건 환경에서 P95 < 300ms |

# | 접근성 | 키보드만으로 가입\~제출 전 과정 완주 가능 |

# 

# \---

# 

# \## 7. 단계별 구현 우선순위 (제안)

# 

# | Phase | 범위 | 기간 가이드 |

# |---|---|---|

# | \*\*Phase 1 (MVP)\*\* | 이메일 가입/로그인, 공고 조회, 지원서 작성/제출, 마이페이지 조회 | 4\~6주 |

# | \*\*Phase 2\*\* | 소셜 로그인, 임시 저장 고도화, 이메일 인증 강제, 지원 철회, 파일 바이러스 스캔 | 2\~3주 |

# | \*\*Phase 3\*\* | OG 미리보기, 면접 일정 .ics, 푸시/이메일 알림, 다국어 | 2\~4주 |

# 

# \---

# 

# \## 8. 미결 정책 결정 사항 (To-Be Discussed)

# 

# > 본 PRD 작성 단계에서 의사결정자 검토가 필요한 항목 모음. 개발 착수 전 확정 권장.

# 

# 1\. 휴대폰 본인 인증(나이스/KMC) 도입 여부 — 비용/UX 트레이드오프

# 2\. 회원 탈퇴 시 진행 중 지원서 처리 정책(익명화 vs 자동 철회)

# 3\. 소셜 계정 자동 연결 허용 여부(보안 vs 편의)

# 4\. 철회 후 동일 공고 재지원 허용 여부

# 5\. 면접관 이름 마이페이지 노출 여부

# 6\. 채용 종료 후 개인정보 보존 기간(법무 검토)

# 7\. 파일 저장소 선정(내부망 환경 — MinIO 자체 호스팅 vs S3 호환 스토리지)

# 

# \---

# 

# \*\*문서 끝.\*\*

