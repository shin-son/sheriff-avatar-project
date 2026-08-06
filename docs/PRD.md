# PRD — Sheriff aVatar Project (SVP)

> 이 문서는 SVP가 **어떤 문제를 왜, 어디까지 해결하는지**를 정의하는 제품 요구사항 문서다. 기준일 2026-08-03.
> 구현 상세는 [ARCHITECTURE.md](./ARCHITECTURE.md), 기능별 완료 기준은 [BACKEND.md](./BACKEND.md),
> 프로토콜은 [API.md](./API.md) 참고. 사내 실값(URL·계정·도구 경로)은 이 문서에 쓰지 않고
> [INTERNAL-ASSETS.md](./INTERNAL-ASSETS.md) 템플릿으로만 관리한다.

## 1. 문제 정의

사내 CI/CD에서 테스트가 실패하면 Jira에 티켓이 생기고, 당번(Sheriff)이 원인을 파악해 담당자를 판정한다.
이 triage에 구조적 문제가 있다 (수치는 [ROI.md](./ROI.md) — 사내 실측 기반 추정):

- **물량 대비 공급 부족**: CI 실패 티켓 일평균 ~294건, 건당 정밀 triage 20~30분. 당번은 3~4명이 각자
  하루 1시간만 투입 — 정밀 triage 커버리지 약 3%. 나머지는 표면적 분류·지연·방치된다.
- **triage 시간의 대부분이 로그 찾기**: 티켓 description에는 실패 로그가 없다. Jenkins 중계 빌드를 따라가
  실패 샤드 콘솔(수 MB)에서 해당 TC 구간을 사람이 찾아야 한다.
- **증거 소실**: Jenkins 콘솔은 로테이션으로 수개월 내 사라진다 — 나중에 같은 실패가 재발해도 역추적할 원문이 없다.
- **지식 미축적**: "이 에러는 늘 저 모듈 문제"라는 판정 노하우가 당번 개인에게만 쌓이고, 3개월 로테이션마다 리셋된다.

## 2. 목표와 성공 기준

SVP의 목표는 **triage 판정을 팀의 해결 이력(LLM-WIKI)에 근거한 자동 분류로 대체하되, 근거가 약하면 반드시
사람에게 넘기는 것**이다. 성공 기준은 검증 가능한 것만 둔다:

| 목표 | 성공 기준 | 검증 |
|---|---|---|
| 전량 1차 분류 | 신규 티켓마다 초도분석(로그 수집 + query + 분류) 정확히 1회, 재시작에도 중복 0회 | F1·F13 — 재시작 후 `restored` 로그, LLM 재호출 0건 |
| 자동 배정 게이트 | `confidence > SVP_LLM_CONFIDENCE_MIN`(기본 80) **그리고** category ≠ unknown일 때만 자동 배정 (assignee + 근거 댓글 + In Progress 전이) | F3·F5 — 코드의 게이트 조건 + mock Jira에서 write 확인 |
| human-in-the-loop 경계 | 임계 이하는 예외 없이 당번 큐 + 담당자 후보(Gerrit 커미터 + wiki owner) 첨부 | F4·F12 — 당번 화면 후보 표시 |
| 해결 이력 재사용 | 해결(Done) 티켓이 raw 동결 + case-log로 ingest되어 다음 query의 검색 대상이 됨 | F7 — case-log 1건 기록, 같은 유형 재유입 시 매치 |
| 무정지 파이프라인 | LLM·Jenkins·사내 도구가 전부 죽어도 티켓은 유실되지 않고 당번 큐에 남음 (`confidence: 0` fallback) | F3·F9 — 자격증명 제거 후에도 당번 배정 정상 |
| 지식 자기 교정 | 재발 가중·supersede·피드백 감점이 query 점수에 반영 | F10·F11 — `npm test` (서버 순수 함수 49 테스트 통과) |

자동 배정 비율 자체는 성공 기준이 아니라 **관측 지표**다 — vault 축적에 따라 올라가는 것을 기대하지만,
목표 수치는 dry-run 실측 후에만 설정한다 (ROI.md의 30%는 보수 가정이지 요구사항이 아님).

## 3. 비목표 (Non-goals)

- **CI 자체를 고치지 않는다.** SVP는 실패의 원인 분류와 배정까지만 한다. 테스트 수정·재실행·빌드 복구는 담당자의 일이다.
- **Jira를 대체하지 않는다.** Jira assignee가 배정의 단일 진실(single source of truth)이고, 해결 확정도
  Jira Done이 유일한 경로다. SVP는 Jira 위에서 읽고(폴링) 쓰는(댓글·assignee·전이) 보조 계층이다.
- **완전 자동화가 아니다.** 신뢰도 임계 이하(기본 ≤80)는 **반드시 사람(당번)이 판정**한다. 임계는 자동화와
  사람 판단의 명시적 경계이며, 근거 없이 임계를 넘지 못하게 프롬프트·클램프로 강제한다 (§6).
- **범용 티켓 분류기가 아니다.** 대상은 CI 실패 티켓(JQL로 한정)이며, description·Jenkins 빌드 구조가
  사내 CI 컨벤션에 맞춰져 있다. 다른 팀 적용 시 vault 시딩과 파서 조정이 필요하다 (ROI.md "확장성").

## 4. 사용자와 역할

팀원 전원이 Windows EXE로 앱을 설치하고 로그인한다. 역할은 서버가 로그인 시 결정한다.

| 역할 | 화면 | 권한·책임 |
|---|---|---|
| **당번 (sheriff)** | 대시보드 — 팀 전체 이슈 | 임계 이하 이슈 판정·수동 재배정(`issue:reassign`), 위키 점검(lint) 실행 |
| **팀원 (member)** | 컴팩트 창 — 자기 배정분만 | 배정 이슈 처리(Jira에서 해결), 참조 노트 일치/불일치 피드백 |

공통: 새 배정 시 우하단 팝업(toast) 알림, 재접속 시 미해결 배정분 replay. 서버가 역할별로 push를
필터링하므로 팀원은 타인의 이슈를 받을 수 없다 (F6).

현재 인증은 데모 수준이다 — admin/admin = 당번, 아이디=비밀번호 = 팀원 (§8 한계 참고).

## 5. 기능 요구사항

기능은 [BACKEND.md](./BACKEND.md)의 F번호로 정의되어 있다 (완료 기준·검증 방법 포함). 여기서는 요구사항
관점의 요약만 둔다:

| # | 요구사항 요약 |
|---|---|
| [F1](./BACKEND.md#f1--jira-폴러) | Jira REST 폴링(기본 5초)으로 신규 티켓 유입 + 추적 티켓의 status/assignee 변경 감지 |
| [F2](./BACKEND.md#f2--wiki-query) | 티켓 텍스트로 wiki-vault 관련 노트 검색 (키워드 스코어링 + LLM 드릴다운, 실패 시 키워드만) |
| [F3](./BACKEND.md#f3--llm-분류기-claude) | Claude가 노트를 근거로 `{category, severity, confidence 0~100, summary, evidence}` 산출 |
| [F4](./BACKEND.md#f4--배정-라우터--수동-재배정) | assignee 기준 라우팅 (bot/빈값 → 당번 큐, 사람 → 그 세션) + 당번의 수동 재배정 |
| [F5](./BACKEND.md#f5--jira-라이터) | Jira write 3종 (assignee·분석 댓글·In Progress 전이) — 전부 write 게이트 경유 (§6) |
| [F6](./BACKEND.md#f6--클라이언트-push-socketio) | Socket.IO push — 로그인·역할 부여·서버 측 필터링·재접속 replay |
| [F7](./BACKEND.md#f7--해결-감지--wiki-ingest) | 해결(Done) 감지 → raw 동결 + LLM 요약 case-log 기록 + index/log 자동 갱신 (멱등) |
| [F8](./BACKEND.md#f8--wiki-위생-feedback) | 참조 노트 일치/불일치 피드백 집계 → 불일치 누적 노트 query 감점 + 해결 시 toast 즉석 피드백 |
| [F9](./BACKEND.md#f9--ci-로그-자동-수집-파이프라인) | Jenkins 실패 샤드 콘솔에서 해당 TC 실행 구간 자동 추출 + 로그 정형화 (전 단계 폴백) |
| [F10](./BACKEND.md#f10--ingest-중복-제거재발-감지) | 같은 실패 서명의 재발은 anchor 하나 + 포인터로 축약, raw는 티켓마다 보존 |
| [F11](./BACKEND.md#f11--retrieval-self-correction) | 검색 자기 교정 — 재발 가중(boost), reopen 시 최신 결론 우선(supersede), 피드백 감점 |
| [F12](./BACKEND.md#f12--담당자-후보-추천) | 임계 이하 티켓에 담당자 후보 첨부 — Gerrit 마지막 커미터 + wiki 노트 owner |
| [F13](./BACKEND.md#f13--이슈-캐시-영속화) | 초도분석 결과 디스크 영속 — 재시작 시 재수집·재분류·재알림 없음 |
| [F14](./BACKEND.md#f14--분석-코멘트-채널) | 분석 댓글 전송 채널 선택 (Jira REST 기본 / MCP — REST가 막힌 환경 대응, 실패 시 REST 폴백) |
| [F15](./BACKEND.md#f15--wiki-lint-vault-점검) | 당번 요청 시 vault 위생 점검 — 고아 노트·frontmatter 스키마 위반·노트 공백(gap) 탐지 + healthScore |

## 6. 품질·안전 요구사항

실티켓과 지식 저장소를 다루므로, 다음은 기능이 아니라 **불변 조건**이다:

- **3단 write 게이트** — 서버발 Jira write(자동 배정 3종 + 수동 재배정)는 전부 `SVP_JIRA_WRITE_MODE`를
  거친다: `dry-run`(기본 — 로그만) → `label`(`SVP_TEST_LABEL` 붙은 티켓만) → `live`. 검증 전에는 실티켓을
  절대 건드리지 않는다. vault 쓰기도 별도 게이트 `SVP_INGEST_MODE`(dry-run 기본/live)를 거친다.
- **신뢰도 임계** — 자동 배정은 `confidence > SVP_LLM_CONFIDENCE_MIN`(기본 80, strictly greater)일 때만.
  프롬프트가 "wiki 근거 없이 80을 넘기지 마라"를 강제하고, 응답은 enum·범위 클램프로 후처리한다.
  LLM 실패·자격증명 부재는 `confidence: 0` fallback — 자동 배정이 불가능해질 뿐 파이프라인은 멈추지 않는다.
- **근거 없는 원인 금지** — ingest 요약 프롬프트 규칙(`server/classifier.mjs`): 확정 근거가 없는 원인은
  반드시 `추정:` 접두사, 자료에 없으면 `(불명)`. LLM의 추정이 사실로 vault에 전파되는 것을 막는다.
- **raw 불변 동결** — 해결 확정 시점의 Jira 원문·CI 로그를 `wiki-vault/raw/`에 사본으로 동결하고 이후
  수정하지 않는다. reopen 후 재해결은 덮어쓰지 않고 `-r<n>` 버전으로 별도 기록한다 (F7).
- **오염 차단** — 로그 정형화 스킬 출력은 화이트리스트(`isFormattedLog`) 통과 시에만 채택, 거부 시 raw 유지 (F9).
- **회귀 방지** — 판정 로직(멱등성·중복 제거·검색 보정·로그 판정 등)은 순수 함수로 분리해 단위 테스트
  49건(`npm test`, `server/*.test.mjs` 6파일)으로 고정한다. 커밋 전 `npm run typecheck` 통과 필수.

## 7. 운영 환경

| 구성 요소 | 환경 |
|---|---|
| 클라이언트 | Windows 10/11, EXE 인스톨러 배포 (`npm run dist` → `dist/`) — Electron 33 + React 18 + TS strict |
| 서버 | headless Node 20 (plain `.mjs`), 운영은 Linux systemd — 포트 8793 (Socket.IO 겸용) |
| 외부 시스템 | 사내 Jira(REST 폴링 + write), Jenkins(실패 로그 추출), Gerrit(MCP, 후보 조회), Claude(Bedrock/Bedrock-Invoke/Anthropic — `SVP_LLM_PROVIDER`) |
| 로컬 개발 | mock Jira(8792) + mock Jenkins(8794) + 서버(8793) + `npm run dev` — 사내 시스템 없이 전체 파이프라인 재현 |

- 사내 접속 실값(호스트·PAT·JQL·bot 계정)은 `.env`로만 주입하며 커밋 금지. 사내 전용 자산(1차 로그 수집
  스크립트, 로그 정형화 스킬, MCP 서버 설정)은 [INTERNAL-ASSETS.md](./INTERNAL-ASSETS.md) 템플릿으로
  관리한다 — 전부 **없어도 동작**하며, 각 자산의 부재 시 폴백 경로가 코드에 구현되어 있다.
- 설정 항목 전체와 배포·트러블슈팅 절차는 [SETUP.md](./SETUP.md).

## 8. 미해결 사항·알려진 한계

코드에서 확인 가능한 것만 적는다:

- **인증이 데모 수준** — admin/admin = 당번, 아이디=비밀번호 = 팀원 (`server/index.mjs` — "Demo auth until
  SVP-5"). 사내 계정 연동 전까지 운영 배포 불가.
- **클라이언트 로컬 피드백 기록**은 서버의 `.feedback.json` 집계와 미연동 (v2 잔재 — 서버 집계가 정본).
- **Jira write 실패 시 재시도 없음** — 로그만 남기고 계속 진행. assignee 성공 후 댓글·전이가 실패해도
  배정을 되돌리지 않는다 (F5).
- **폴링 백오프 없음** — Jira 장애 시 매 주기 에러 로그 후 재시도. 복구되면 base JQL 전체 재조회로 따라잡는다 (F1).
- **LLM 비용 미실측** — 티켓당 API 2~3회 + 보조 세션 0~2회 규모의 추정만 있고, 순 ROI는 dry-run 실측
  토큰으로 확정해야 한다 ([ROI.md §4](./ROI.md)).
- **이식 비용** — 새 팀 적용은 `.env` 설정 외에 vault 시딩(모듈 노트·owner 매핑)이 필요하고, 티켓
  description·Jenkins 빌드 구조가 다르면 파서 조정이 따른다.
- **분류 정확도·자동 배정률 미검증** — 파이프라인은 mock + 사내 dry-run으로 동작 검증됐지만, 실 트래픽
  기준 분류 정확도와 자동 배정률은 아직 측정 전이다. label → live 전환 판단은 이 실측 후에 한다.
