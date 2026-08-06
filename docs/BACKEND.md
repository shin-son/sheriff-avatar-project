# SVP 백엔드 핵심 기능 명세

> 서버(`server/*.mjs`, headless Node — `npm run server`, 포트 8793)가 제공하는 기능을 F번호로 정의한다.
> 구조는 [ARCHITECTURE.md](./ARCHITECTURE.md), 프로토콜 세부는 [API.md](./API.md) 참고. 상태는 2026-08-03 코드 기준.
> 각 기능의 완료 기준은 "검증"으로 명시 — 테스트가 있는 기능은 `npm test`(하단 검증 섹션), 나머지는 수동 확인 절차.

## 기능 목록

| # | 기능 | 모듈 | 상태 |
|---|---|---|---|
| F1 | Jira 폴러 (이슈 유입) | `server/index.mjs` | 구현 완료 |
| F2 | WIKI query (분류 근거 검색) | `server/wiki-query.mjs` | 구현 완료 (키워드 + LLM 드릴다운) |
| F3 | LLM 분류기 | `server/classifier.mjs` | 구현 완료 (Claude, provider 3종) |
| F4 | 배정 라우터 + 수동 재배정 | `server/index.mjs` | 구현 완료 |
| F5 | Jira 라이터 (댓글·assignee·전이) | `server/jira.mjs` | 구현 완료 (write-mode 게이트) |
| F6 | 클라이언트 push (Socket.IO) | `server/index.mjs` | 구현 완료 — 초기 명세(8791 raw-WS hub)는 폐기 |
| F7 | 해결 감지 → WIKI ingest | `server/ingest.mjs` | 구현 완료 |
| F8 | WIKI 위생 (feedback) | `server/wiki-query.mjs` + 클라이언트 | 구현 완료 (해결 toast 즉석 피드백 포함) |
| F9 | CI 로그 자동 수집 파이프라인 | `server/ci-test-fetch.mjs` + `server/jenkins.mjs` | 구현 완료 (1차 경로는 사내 자산 의존 — [INTERNAL-ASSETS.md](./INTERNAL-ASSETS.md)) |
| F10 | ingest 중복 제거·재발 감지 | `server/ingest.mjs` | 구현 완료 |
| F11 | retrieval self-correction | `server/wiki-query.mjs` | 구현 완료 |
| F12 | 담당자 후보 추천 | `server/wiki-query.mjs` (`buildCandidates`) | 구현 완료 (Gerrit 경로는 사내 자산 의존 — [INTERNAL-ASSETS.md](./INTERNAL-ASSETS.md)) |
| F13 | 이슈 캐시 영속화 | `server/cache.mjs` | 구현 완료 |
| F14 | 분석 코멘트 채널 (rest/mcp) | `server/comment-channel.mjs` | 구현 완료 |
| F15 | WIKI lint (vault 점검) | `server/wiki-lint.mjs` | 구현 완료 (당번 수동 트리거) |

## F1 — Jira 폴러

- **책임**: `SVP_SERVER_POLL_MS`(기본 5000ms) 주기로 두 갈래 — (1) base JQL로 신규 티켓 유입(기존 키 스킵),
  (2) 추적 키 `key in (...)` sync로 status/assignee 변경 감지 (Resolved가 base JQL을 벗어나도 보인다).
- **불변 조건**: 티켓당 초도분석은 정확히 1회(`issue-cache.json`, F13 — 재시작에도 유지). 두 갈래는 single-flight
  가드를 **분리** — 초도 수집(Jenkins fetch 포함, 수 초+)이 오래 걸려도 sync는 계속 돈다. sync는 진행 중 들어온
  재실행 요청(배정 직후 재읽기)을 버리지 않고 사이클 종료 후 한 번 더 도는 코얼레싱 방식.
- **실패 시**: 백오프 없음 — 에러 로그 후 다음 주기 재시도. 복구되면 base JQL 전체 재조회로 따라잡는다.
- **검증**: mock Jira 티켓 3개 → 각 1회 분류. 서버 재시작 → 재분류 0건 (`restored` 로그).

## F2 — WIKI query

- **책임**: 티켓 텍스트로 `wiki-vault/`에서 관련 노트를 찾아 classify 입력으로 넘긴다. case-log도 엔트리 단위로
  검색 대상 — 해결 사례가 쌓일수록 같은 유형의 매치가 강해진다 (compounding). 두 경로의 합집합:
  - **키워드 스코어링** (`queryWiki`) — 양방향: 이벤트 module/제목 키워드가 노트에 있으면 +(module +3, 그 외
    +1), 노트의 tags·known-failure 원문 신호가 티켓 로그에 있으면 +2. score > 0 상위 3건.
  - **LLM 드릴다운** (`selectNotes`) — classify 전에 로그로 원인을 가설화하고 카탈로그(본문 없음)에서 노트를 최대
    3개 고른다. 카탈로그 밖 경로는 버리고, 무자격증명·호출 실패 시 빈 결과 폴백 — 키워드만으로 진행.
- **검증**: 수동 — auth 토큰 이슈 → `modules/auth.md` 매치, 로그에만 신호가 있어도 매치. 스코어 보정은 F11 테스트.

## F3 — LLM 분류기 (Claude)

- **구현**: provider 3종(`SVP_LLM_PROVIDER`: bedrock/bedrock-invoke/anthropic), 기본 모델 Claude Opus 4.8.
  티켓 + wiki 노트로 `{category, severity, confidence, summary, evidence}` 산출 ([API.md §3](./API.md)).
  해결 요약(`summarizeResolution`, F7용)과 노트 선택(`selectNotes`, F2)도 이 모듈.
- **핵심 규칙**: `confidence`는 wiki 근거 강도에 비례 — 근거 없이 80을 넘기지 않는다. 프롬프트에 4구간 밴드로
  캘리브레이션(85–95 노트가 실패를 그대로 문서화 — direct match는 반드시 80 초과 / 65–80 모듈만 명확 /
  51–64 약한 근거 / ≤50 근거 없음)하고, 응답은 enum·범위 클램프로 방어 ([API.md §3](./API.md)).
  자동 배정 게이트는 `confidence > SVP_LLM_CONFIDENCE_MIN`(기본 80) **그리고** category ≠ unknown **그리고** 분류 완료
  시점에도 당번 큐·new 상태일 때만. LLM 실패·자격증명 부재 시 `confidence: 0` fallback — 파이프라인은 멈추지 않고 티켓은 당번 큐 유지.
- **검증**: 수동 — wiki 근거 있는 이슈 >80, 처음 보는 유형 ≤80. 자격증명 제거 후에도 당번 배정 정상.

## F4 — 배정 라우터 + 수동 재배정

- **책임**: Jira assignee가 단일 진실 — bot(`SVP_JIRA_BOT`)/빈값 → 당번(admin) 큐, 사람 → 그 사람 세션에 push
  (`routeByAssignee`). 자동 배정(F3 게이트 통과)도 로컬 상태가 아니라 Jira에 쓰고 sync가 읽어 push한다.
- **수동 재배정**: 당번만 `issue:reassign`(C→S) → `setAssignee` + 수동 배정 댓글 → poll sync가 기존/신규 담당자
  양쪽에 `issue:updated` push (기존 담당자 화면에서 제거됨).
- **검증**: 수동 — ≤80 이슈를 당번이 B에게 재배정 → B 팝업, 당번 화면 상태 일치, Jira assignee 변경.

## F5 — Jira 라이터

- **책임**: write 3종 — `postComment`, `setAssignee`, `transitionTo`(In Progress) + 분석 댓글 템플릿
  `buildComment`. ingest용 원문 조회 `getIssueRaw`도 이 모듈.
- **불변 조건**: 모든 서버발 Jira write는 `SVP_JIRA_WRITE_MODE` 게이트 경유 — dry-run(기본, 로그만) /
  label(`SVP_TEST_LABEL` 티켓만) / live. 분석 댓글은 분류가 끝난 **모든 bot-배정 티켓**에 1건 — 자동 배정이
  없어도(≤80·담당자 미등록) 근거를 남긴다. 자동 배정 시에는 assignee 성공 후에만 댓글·전이. 쓰기 실패
  순간 장애(네트워크·429·5xx)는 지수 백오프 재시도(`server/retry.mjs`, 기본 2회), 4xx는 즉시 실패.
  소진 후에는 로그 후 계속 (assignee 성공 후 댓글/전이 실패는 배정을 되돌리지 않는다).
- **검증**: 수동 — mock Jira `GET /demo/tickets`에서 댓글·assignee·상태가 시나리오대로 기록됨.

## F6 — 클라이언트 push (Socket.IO)

- 초기 명세(포트 8791 raw-WS hub, `modules/hub/`)는 **폐기** — push 계층은 `server/index.mjs` 안의 Socket.IO로
  구현됐다 (포트 8793 공유, handshake auth 로그인: admin/admin → sheriff, 아이디=비밀번호 → member).
- **이벤트 6종** (ack 이벤트는 제거됨 — 해결 경로는 Jira Done이 유일):
  `session`(S→C, 로그인 직후 user + roster + confidenceMin — roster 변경 시 전 세션 재전송) ·
  `issue:new`(S→C — 재접속 시 미해결 배정분 replay, 재시작 복원분은
  `restored: true`로 toast 억제) · `issue:updated`(S→C, 재배정 시 기존 담당자에게도) · `issue:reassign`(C→S, F4) ·
  `wiki:feedback`(C→S, F8) · `wiki:lint`(C→S, sheriff 전용 ack RPC, F15). **서버 측 필터링**: member에게는 자기 배정분만, 접속 중인 sheriff에게는 전부.
- **검증**: 수동 — A 접속 끊고 A에게 배정 → A 재접속 시 복원. B에게는 A의 이슈가 보이지 않음.

## F7 — 해결 감지 → WIKI ingest

- **책임**: tracked sync가 resolved 진입을 감지하면 `ingestResolved`(fire-and-forget — poll을 막지 않음): raw 증거
  동결(`raw/jira/`, `raw/ci/` — `raw/gerrit/`은 Change-Id가 있을 때만) → LLM이 해결 코멘트로
  symptom/cause/resolution 요약 → case-log append →
  `index.md`/`log.md` 재생성. vault write는 `SVP_INGEST_MODE`(dry-run 기본/live) 게이트.
- **멱등성**: `decideIngest` — resolvedAt(Jira updated) 기준. 재시작·중복 폴링(같은 resolvedAt)은 스킵, reopen 후
  재해결(더 늦은 resolvedAt)만 `-r<n>` 버전 raw + supersede 표식으로 재기록. 상태는 `.ingest-state.json` 영속.
- **검증**: `ingest.test.mjs` decideIngest 5케이스 + 수동 — Done 처리 → case-log 1건, 재시작 후 중복 0건.

## F8 — WIKI 위생 (feedback)

- **구현됨**: 담당자가 이슈 상세(DetailPanel/CompactView)에서 참조 노트의 **일치/불일치**(👍/👎)를 판정 →
  `wiki:feedback` 소켓으로 서버 전달 → `recordFeedback`이 `wiki-vault/.feedback.json`에 누적 → `queryWiki`가
  불일치 누적(`SVP_FEEDBACK_DEMOTE` 기본 3+ 그리고 down > up) 노트를 점수 반감 (`feedbackDemotion`, F11③).
- **해결 시 피드백 요청 push**: 해결(Done) 전이가 push되면 해결 담당자의 toast가 피드백 요청 모드로
  전환 — 상위 참조 노트를 toast에서 바로 👍/👎 평가(1클릭), 나머지 노트는 클릭해 상세 패널에서.
  피드백 누적 노트의 정리 후보 보고는 서버 lint(F15)가 맡는다 — 실제 수정·삭제는 사람 PR 전용.
- **한계**: 클라이언트 로컬 피드백 기록은 서버 `.feedback.json` 집계와 미연동 (v2 잔재).
- **검증**: `wiki-query.test.mjs` feedbackDemotion 케이스 + 수동 — ① `/demo/resolve` 후 해결 담당자
  toast가 피드백 요청 모드로 전환 → 👍/👎 클릭 → 서버 로그 `feedback from <id>` 확인, ② 불일치 3회 →
  해당 노트 query 점수 반감.

## F9 — CI 로그 자동 수집 파이프라인

- **책임**: description에는 실패 로그가 없다 — 신규 티켓마다 실제 로그를 확보해 분류·ingest 근거를 만든다. 전 단계 실패 시 description 로그로 진행 (파이프라인 정지 없음):
  1. description(HTML→text)에서 Jenkins 빌드 URL·TC명 추출, `probeBuildUrl`로 죽은 링크 사전 배제.
  2. 1차 `fetch_ci_test.py`(`.tool/Jenkins/`) 직접 실행 → 실패 시 `jenkins.mjs` 직통 REST 폴백: relay 빌드의
     `CI TEST RESULT` 샤드 링크 추적 → 실패 샤드 콘솔(~9MB)에서 해당 TC 실행 구간만 추출, 못 찾으면 콘솔 꼬리.
  3. 확보 로그는 format-ci-log 스킬(headless `claude -p`)로 양식화 — `isFormattedLog` 화이트리스트가 스킬 부재
     환경의 에러 출력이 raw 로그를 덮어쓰는 오염을 차단, 거부 시 raw 그대로. 판정 기준: exit 성공 + 비어있지 않음 +
     `FORMAT_FAILED` sentinel 아님 + 200자 이상(`MIN_FORMATTED_LEN` — 짧은 출력은 에러/거부로 간주) +
     에러 시그니처 정규식(`unknown command` 등) 불일치. 과다 거부는 안전하다 — 거부되면 raw를 그대로 쓴다.
- **검증**: `ci-test-fetch.test.mjs` 5케이스(isFormattedLog) + `jenkins.test.mjs` 7케이스(URL 추출·샤드 링크·
  TC 구간 추출) + 수동 — `SVP_DEBUG_DUMP_DIR` 덤프로 수집 로그 확인.

## F10 — ingest 중복 제거·재발 감지

- **책임**: 서로 다른 티켓이 같은 실패 서명이면 case-log '지식'은 anchor 하나로 유지하고 나머지는 포인터 + 재발
  카운트만 남긴다 (LLM summarize 스킵). raw 증거는 티켓마다 보존.
- **구현**: `signatureOf`(TC명 우선, 제목 정규화 폴백) → `.signature-index.json` → `classifyIngest` 4모드:
  `full`(신규 서명·창 만료) / `anchor-reresolve`(anchor 재해결 — supersede 풀 엔트리) / `member-reresolve`(dedup된
  비-anchor 재해결 — 재anchor 금지) / `recurrence`(새 중복 — 카운트+1). 같은 모듈 + `SVP_DEDUP_WINDOW_DAYS`(기본 14일) 내에서만 재발로 묶는다 (flaky·별개 회귀 오탐 방지).
- **검증**: `ingest.test.mjs` — signatureOf 2, isDuplicateRecurrence 2, classifyIngest 4케이스 (anchor 뒤집힘 회귀 포함).

## F11 — retrieval self-correction

- **책임**: query가 vault의 노이즈를 스스로 걸러낸다 — 보정 3종:
  ① case-log 포인터 엔트리 제외 + 같은 티켓의 full 엔트리는 최신만 (reopen 교정본이 이전 기록 supersede —
  `caseLogEntries`) ② 재발 count 높은 known-failure 상향 (`recurrenceBoost`, count−1, 상한 `SVP_RECUR_BOOST_CAP`
  기본 4) ③ 불일치 피드백 누적 노트 감점 (`feedbackDemotion`, F8 연동).
- **검증**: `wiki-query.test.mjs` 4케이스 (caseLogEntries 2, recurrenceBoost 1, feedbackDemotion 1).

## F12 — 담당자 후보 추천

- **책임·구현**: 자동 배정 조건(>80 AND ≠ unknown)을 못 채운 티켓에 human-in-the-loop 후보를 첨부 (`buildCandidates`) —
  (1) Gerrit MCP(headless `claude -p`, `query_changes`)로 TC 파일의 마지막 커미터, (2) wiki 모듈 노트 frontmatter
  `owner`. Gerrit 우선 정렬, `issue.candidates`로 `issue:updated` push + 캐시 저장.
- **검증**: 수동 — dry-run에서 `candidates for <key>` 로그, 당번 화면 후보 표시.

## F13 — 이슈 캐시 영속화

- **책임**: 티켓별 초도분석 결과(Jenkins 보강 로그·분류·후보)를 `server/issue-cache.json`에 영속 — 재시작 시 재수집·재분류·재toast
  없음 (`restored: true` push). resolve 시 삭제, reopen 시 **분류 결과 포함** 캐시 재기록(재시작 후에도 재추적).
  Jira가 status/assignee의 진실이므로 캐시 유실은 재분석 비용일 뿐 정합성 문제가 아니다.
- **캐시 기반 재배정** (`reassignFromCache`): 복원 티켓이 캐시된 고신뢰 분류(> 게이트 AND ≠ unknown)를 갖고도
  당번 큐에 있으면(분류 시점 dry-run·assignee 실패·Jira에서 되돌림) 재분류·재댓글·재전이 없이 `setAssignee`만
  재시도 — write 게이트 적용이라 **복원 시에도 Jira write가 발생할 수 있다** (dry-run이면 `would re-assign` 로그만).
- **쓰기 직렬화**: 캐시 저장은 poll 루프·classifyAndAct에서 fire-and-forget으로 겹칠 수 있어 프라미스 체인으로
  직렬화한다 — `writeFile` 인터리브로 JSON이 깨지는 것을 방지.
- **검증**: 수동 — 분류 완료 후 재시작 → `issue-cache: N ticket(s)` 로그, LLM 재호출 0건.

## F14 — 분석 코멘트 채널

- **책임**: 분석 댓글(F5) 전송 경로 선택 — `SVP_COMMENT_CHANNEL`: rest(기본, Jira REST 직접) / mcp(headless
  `claude -p`가 등록된 MCP Jira 툴로 기입 — REST가 막힌 사내 환경 대응). mcp 실패 시 REST 폴백으로 유실 방지.
- **한계 (드문 엣지)**: mcp 채널에서 claude가 기입에는 성공하고 "OK" 출력만 실패하면 REST 폴백이 겹쳐
  **댓글이 중복될 수 있다** — 유실보다 중복을 택한 설계.
- **검증**: 수동 — 기동 로그 `comment-channel:` 확인, mock Jira 티켓에 댓글 기입 확인.

## F15 — WIKI lint (vault 점검)

- **책임**: 서버 vault의 read-only 건강 점검 — 고아 노트(어느 노트에서도 파일 stem이 단어로 참조되지 않음),
  frontmatter 스키마 위반(필수 키 누락 critical·module-파일명 불일치 warn), 부정 피드백 누적 노트(warn 정리 후보),
  공백 탐지(노트 없는 카테고리의 티켓 묶음 — inverse lint), severity 감점 합산 헬스 스코어.
  **아무것도 쓰지 않는다** — `index.md`/`log.md` 재생성은 ingest(F7) 소유, 실제 수정·삭제는 사람 PR 전용.
- **트리거**: 당번이 앱에서 `wiki:lint`(sheriff 전용 ack RPC, [API.md §1](./API.md)) — 서버가 `WikiLintReport` 반환.
- **검증**: `wiki-lint.test.mjs` 11케이스 — findOrphans 3(단어 경계·case-log 제외 포함) · schemaIssues 3 ·
  gapIssues 1 · healthScore 1 · lintVault 3.

## 검증 — 자동 테스트

`npm test` = `node --test "server/**/*.test.mjs"` — **49 tests** (순수 함수 회귀 테스트):

| 파일 | 케이스 | 대상 |
|---|---|---|
| `server/ingest.test.mjs` | 13 | decideIngest 5 · signatureOf 2 · isDuplicateRecurrence 2 · classifyIngest 4 — F7·F10 |
| `server/wiki-lint.test.mjs` | 11 | findOrphans 3 · schemaIssues 3 · gapIssues 1 · healthScore 1 · lintVault 3 — F15 |
| `server/wiki-query.test.mjs` | 8 | caseLogEntries 2 · recurrenceBoost 1 · feedbackDemotion 1 · parseFrontmatter 3 · listOf/primaryOf 1 — F11·F8 |
| `server/jenkins.test.mjs` | 7 | extractBuildUrl 1 · shardLinksIn 2 · tcSectionIn 4 — F9 |
| `server/ticket.test.mjs` | 5 | htmlToText 2 · normalize 3 — F1 |
| `server/ci-test-fetch.test.mjs` | 5 | isFormattedLog — F9 |
| `server/retry.test.mjs` | 5 | backoffDelay 1 · isRetryableStatus 1 · withRetry 3 — Jira/Jenkins 재시도 |

`npm run test:coverage`(`node --test --experimental-test-coverage`)로 커버리지 확인 — 순수 로직 모듈 기준
`ticket.mjs` 100% / `wiki-lint.mjs` 91.8% 라인 커버리지. LLM·네트워크 I/O 어댑터(classifier·jira 등)는
단위 테스트 범위 밖 — 해당 경로는 위 F별 수동 검증 절차가 담당한다.
