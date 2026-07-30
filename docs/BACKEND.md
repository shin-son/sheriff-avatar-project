# SVP 백엔드 핵심 기능 명세

> 서버(`server/*.mjs`, headless Node — `npm run server`, 포트 8793)가 제공하는 기능을 F번호로 정의한다.
> 구조는 [ARCHITECTURE.md](./ARCHITECTURE.md), 프로토콜 세부는 [API.md](./API.md) 참고. 상태는 2026-07-30 코드 기준.
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
| F8 | WIKI 위생 (feedback) | `server/wiki-query.mjs` + 클라이언트 | 부분 구현 (본문 한계 참고) |
| F9 | CI 로그 자동 수집 파이프라인 | `server/ci-test-fetch.mjs` + `server/jenkins.mjs` | 구현 완료 |
| F10 | ingest 중복 제거·재발 감지 | `server/ingest.mjs` | 구현 완료 |
| F11 | retrieval self-correction | `server/wiki-query.mjs` | 구현 완료 |
| F12 | 담당자 후보 추천 | `server/wiki-query.mjs` (`buildCandidates`) | 구현 완료 |
| F13 | 이슈 캐시 영속화 | `server/cache.mjs` | 구현 완료 |
| F14 | 분석 코멘트 채널 (rest/mcp) | `server/comment-channel.mjs` | 구현 완료 |

## F1 — Jira 폴러

- **책임**: `SVP_SERVER_POLL_MS`(기본 5000ms) 주기로 두 갈래 — (1) base JQL로 신규 티켓 유입(기존 키 스킵),
  (2) 추적 키 `key in (...)` sync로 status/assignee 변경 감지 (Resolved가 base JQL을 벗어나도 보인다).
- **불변 조건**: 티켓당 초도분석은 정확히 1회(`issue-cache.json`, F13 — 재시작에도 유지). poll은 single-flight.
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
- **핵심 규칙**: `confidence`는 wiki 근거 강도에 비례 — 근거 없이 80을 넘기지 않는다(프롬프트 강제 + enum·범위 클램프).
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
  재시도 없음 — 로그 후 계속 (assignee 성공 후 댓글/전이 실패는 배정을 되돌리지 않는다).
- **검증**: 수동 — mock Jira `GET /demo/tickets`에서 댓글·assignee·상태가 시나리오대로 기록됨.

## F6 — 클라이언트 push (Socket.IO)

- 초기 명세(포트 8791 raw-WS hub, `modules/hub/`)는 **폐기** — push 계층은 `server/index.mjs` 안의 Socket.IO로
  구현됐다 (포트 8793 공유, handshake auth 로그인: admin/admin → sheriff, 아이디=비밀번호 → member).
- **이벤트 5종** (ack 이벤트는 제거됨 — 해결 경로는 Jira Done이 유일):
  `session`(S→C, 로그인 직후 user + roster) · `issue:new`(S→C — 재접속 시 미해결 배정분 replay, 재시작 복원분은
  `restored: true`로 toast 억제) · `issue:updated`(S→C, 재배정 시 기존 담당자에게도) · `issue:reassign`(C→S, F4) ·
  `wiki:feedback`(C→S, F8). **서버 측 필터링**: member에게는 자기 배정분만, 접속 중인 sheriff에게는 전부.
- **검증**: 수동 — A 접속 끊고 A에게 배정 → A 재접속 시 복원. B에게는 A의 이슈가 보이지 않음.

## F7 — 해결 감지 → WIKI ingest

- **책임**: tracked sync가 resolved 진입을 감지하면 `ingestResolved`(fire-and-forget — poll을 막지 않음): raw 증거
  동결(`raw/jira/`, `raw/ci/`) → LLM이 해결 코멘트로 symptom/cause/resolution 요약 → case-log append →
  `index.md`/`log.md` 재생성. vault write는 `SVP_INGEST_MODE`(dry-run 기본/live) 게이트.
- **멱등성**: `decideIngest` — resolvedAt(Jira updated) 기준. 재시작·중복 폴링(같은 resolvedAt)은 스킵, reopen 후
  재해결(더 늦은 resolvedAt)만 `-r<n>` 버전 raw + supersede 표식으로 재기록. 상태는 `.ingest-state.json` 영속.
- **검증**: `ingest.test.mjs` decideIngest 5케이스 + 수동 — Done 처리 → case-log 1건, 재시작 후 중복 0건.

## F8 — WIKI 위생 (feedback) — 부분 구현

- **구현됨**: 담당자가 이슈 상세(DetailPanel/CompactView)에서 참조 노트의 **일치/불일치**(👍/👎)를 판정 →
  `wiki:feedback` 소켓으로 서버 전달 → `recordFeedback`이 `wiki-vault/.feedback.json`에 누적 → `queryWiki`가
  불일치 누적(`SVP_FEEDBACK_DEMOTE` 기본 3+ 그리고 down > up) 노트를 점수 반감 (`feedbackDemotion`, F11③).
- **미구현·한계**: "해결(Done) 시 피드백 요청 toast push"는 없다 — 피드백 입력은 상세 패널 UI뿐. 클라이언트 로컬
  lint(`src/main/modules/wiki/`)는 별도 저장소(userData)를 읽어 서버 `.feedback.json` 집계와 미연동 (v2 잔재).
- **검증**: `wiki-query.test.mjs` feedbackDemotion 케이스 + 수동 — 불일치 3회 → 해당 노트 query 점수 반감.

## F9 — CI 로그 자동 수집 파이프라인

- **책임**: description에는 실패 로그가 없다 — 신규 티켓마다 실제 로그를 확보해 분류·ingest 근거를 만든다. 전 단계 실패 시 description 로그로 진행 (파이프라인 정지 없음):
  1. description(HTML→text)에서 Jenkins 빌드 URL·TC명 추출, `probeBuildUrl`로 죽은 링크 사전 배제.
  2. 1차 `fetch_ci_test.py`(`.tool/Jenkins/`) 직접 실행 → 실패 시 `jenkins.mjs` 직통 REST 폴백: relay 빌드의
     `CI TEST RESULT` 샤드 링크 추적 → 실패 샤드 콘솔(~9MB)에서 해당 TC 실행 구간만 추출, 못 찾으면 콘솔 꼬리.
  3. 확보 로그는 format-ci-log 스킬(headless `claude -p`)로 양식화 — `isFormattedLog` 화이트리스트가 스킬 부재
     환경의 에러 출력이 raw 로그를 덮어쓰는 오염을 차단, 거부 시 raw 그대로.
- **검증**: `ci-test-fetch.test.mjs` 5케이스(isFormattedLog) + 수동 — `SVP_DEBUG_DUMP_DIR` 덤프로 수집 로그 확인.

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

- **책임·구현**: 자동 배정이 안 되는 ≤80 티켓에 human-in-the-loop 후보를 첨부 (`buildCandidates`) —
  (1) Gerrit MCP(headless `claude -p`, `query_changes`)로 TC 파일의 마지막 커미터, (2) wiki 모듈 노트 frontmatter
  `owner`. Gerrit 우선 정렬, `issue.candidates`로 `issue:updated` push + 캐시 저장.
- **검증**: 수동 — dry-run에서 `candidates for <key>` 로그, 당번 화면 후보 표시.

## F13 — 이슈 캐시 영속화

- **책임**: 티켓별 초도분석 결과(Jenkins 보강 로그·분류·후보)를 `server/issue-cache.json`에 영속 — 재시작 시 재수집·재분류·재toast
  없음 (`restored: true` push). resolve 시 삭제, reopen 시 복원. Jira가 status/assignee의 진실이므로 캐시 유실은 재분석 비용일 뿐 정합성 문제가 아니다.
- **검증**: 수동 — 분류 완료 후 재시작 → `issue-cache: N ticket(s)` 로그, LLM 재호출 0건.

## F14 — 분석 코멘트 채널

- **책임**: 분석 댓글(F5) 전송 경로 선택 — `SVP_COMMENT_CHANNEL`: rest(기본, Jira REST 직접) / mcp(headless
  `claude -p`가 등록된 MCP Jira 툴로 기입 — REST가 막힌 사내 환경 대응). mcp 실패 시 REST 폴백으로 유실 방지.
- **검증**: 수동 — 기동 로그 `comment-channel:` 확인, mock Jira 티켓에 댓글 기입 확인.

## 검증 — 자동 테스트

`npm test` = `node --test "server/**/*.test.mjs"` — **22 tests** (순수 함수 회귀 테스트):

| 파일 | 케이스 | 대상 |
|---|---|---|
| `server/ingest.test.mjs` | 13 | decideIngest 5 · signatureOf 2 · isDuplicateRecurrence 2 · classifyIngest 4 — F7·F10 |
| `server/wiki-query.test.mjs` | 4 | caseLogEntries 2 · recurrenceBoost 1 · feedbackDemotion 1 — F11·F8 |
| `server/ci-test-fetch.test.mjs` | 5 | isFormattedLog — F9 |
