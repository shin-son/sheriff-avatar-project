# SVP API 명세

> v3 서버(`server/`) 기준의 **실제 구현 계약**만 기술한다. payload 타입은 [src/shared/types.ts](../src/shared/types.ts),
> 전체 구조는 [ARCHITECTURE.md](./ARCHITECTURE.md) 참고.

## 1. 클라이언트 ↔ 서버 (Socket.IO)

서버는 `SVP_SERVER_PORT`(기본 **8793**)에서 리슨, 클라이언트는 `SVP_PUSH_URL`(기본 `http://localhost:8793`)로 접속.
envelope 없음 — 모든 이벤트 payload는 bare 객체다 (예외: `wiki:lint`는 payload 없이 **ack 콜백**으로 결과를 돌려받는 RPC형).
재접속은 socket.io-client 내장. 같은 userId의 중복 로그인은 기존 소켓을 끊는다.

- **로그인**: `io(SVP_PUSH_URL, { auth: { username, password } })`. 데모 인증(SVP-5 전): `admin`/`admin` → sheriff,
  아이디=비밀번호 → member. 실패 시 `connect_error("AUTH_FAILED")` — 클라이언트는 재시도하지 않고 로그인 화면으로.
- **서버 측 필터링**: member 세션에는 본인 assignee 이슈만, sheriff 세션에는 전체가 push된다.

| 방향 | 이벤트 | payload | 설명 |
|---|---|---|---|
| S→C | `session` | `{ user, team, confidenceMin }` | 접속 시 1회 + roster 변경(새 로그인·신규 assignee) 시 **전 세션에 재전송**. 접속 시에는 이어서 이 세션이 볼 미해결 이슈를 `issue:new`로 재생(복원). `confidenceMin` = 서버 자동 배정 게이트 값 |
| S→C | `issue:new` | `SheriffIssue` | 신규 이슈. 서버 재시작 캐시 복원분은 `restored: true` — 클라이언트는 toast 스킵 |
| S→C | `issue:updated` | `SheriffIssue` | 분류 완료·status/assignee sync 반영. 재배정 시 **기존 담당자에게도** 전송(목록에서 제거용) |
| C→S | `issue:reassign` | `{ issueId, assigneeId }` | sheriff 전용 수동 배정(F4). `issueId` = `event.id`(= Jira key). 서버가 Jira assignee PUT + 배정 댓글 → 폴링 sync가 `issue:updated`로 되돌림. write 게이트(§2) 적용 |
| C→S | `wiki:feedback` | `{ note: string, helpful: boolean }` | 참조 노트 일치/불일치 피드백. **키 이름은 `note`**(값은 노트 제목) — 서버 vault에 누적, 👎 누적 노트는 query 감점 |
| C→S | `wiki:lint` | (없음 — ack 콜백) | sheriff 전용. 서버 vault 점검(`server/wiki-lint.mjs`) 결과 `WikiLintReport`를 **ack 콜백(RPC)** 으로 반환, 서버 오류 시 `null`. member 세션에는 ack 자체가 없다 — 클라이언트의 10초 타임아웃이 권한 거부까지 흡수 |

`SheriffIssue`는 `candidates?: CandidateAssignee[]`를 포함한다 — 분류 완료 시점에 당번 큐(`routedTo: 'sheriff'`)·
`new` 상태인 티켓이 자동 배정 조건(confidence > `SVP_LLM_CONFIDENCE_MIN` **그리고** category ≠ `unknown`)을 채우지
못했을 때 서버가 빌드하는 human-in-the-loop 배정 후보 — `unknown` 분류는 고신뢰여도 후보가 생성된다.
출처는 `gerrit`(TC 파일 마지막 커미터)·`wiki`(모듈 노트 owner) 2종
(`case-log`는 타입에 예약만 되어 있고 현재 생성 코드 없음).

## 2. 서버 ↔ Jira (REST v2)

인증: `Authorization: Bearer ${SVP_JIRA_PAT}` (미설정 시 헤더 생략 — mock용).

| 용도 | 호출 |
|---|---|
| 신규 티켓 폴링 | `GET /rest/api/2/search?jql=(${SVP_JIRA_JQL}) ORDER BY created ASC` — fields: `summary,description,status,created,updated,assignee,labels` |
| 추적 티켓 sync | `GET /rest/api/2/search?jql=key in (k1,k2,...)` — **key 목록만**, base JQL과 독립 |
| 담당자 지정 | `PUT /rest/api/2/issue/{key}/assignee` body `{ "name": "<username>" }` |
| 담당자 지정 폴백 | 위가 실패하면 `PUT /rest/api/2/issue/{key}` body `{ "fields": { "assignee": { "name" } } }` — 사내 Jira가 표시명을 assignee 엔드포인트에서 400으로 거부하는 실측 케이스 대응. mock Jira는 이 폴백 경로를 구현하지 않아 mock으로는 재현 불가 |
| 댓글 | `POST /rest/api/2/issue/{key}/comment` body `{ "body": "..." }` |
| 상태 전이 | `GET /rest/api/2/issue/{key}/transitions`로 이름 매칭(예: `In Progress`) 후 `POST .../transitions` `{ transition: { id } }` |
| ingest 원문 동결 | `GET /rest/api/2/issue/{key}?fields=description,comment` (F7 — resolved 시) |

- **신규 폴링에 `created >=` 경계를 쓰지 않는 이유**: 그 경계는 JIRA 프로필 타임존으로 해석되어(서버 PC와 다름)
  신규 티켓이 조용히 누락된다. 대신 base JQL 전체를 매번 조회하고 이미 아는 키는 메모리에서 스킵한다
  (팀 JQL이 Resolved를 제외하므로 활성 집합은 작다).
- **tracked-key sync가 별도인 이유**: base JQL을 벗어난 티켓(예: Resolved 전이)의 status/assignee 변화를
  계속 봐야 하기 때문. resolved → open 재전이(reopen)도 이 경로로 감지한다.
- **쓰기 게이트**: 서버발 Jira write 전부(자동 배정 3종 + 수동 reassign + 캐시 기반 재배정 + 분석 댓글)는
  `SVP_JIRA_WRITE_MODE`를 따른다 — `dry-run`(기본, 로그만) / `label`(`SVP_TEST_LABEL` 라벨 티켓만) / `live`(전면 허용).
- **자동 배정 (confidence > 80 AND owner 해석 가능)**: ① assignee PUT(실패 시 전체 중단 — 배정 없이 "자동 배정"
  댓글 금지) → ② 분석 댓글 → ③ In Progress 전이(②③ 실패는 로그 후 진행).
- **캐시 기반 재배정** (`reassignFromCache`): 재시작 복원 티켓이 캐시된 분류(> 게이트 AND ≠ unknown)를 갖고도
  아직 당번 큐에 있으면(분류 시점 dry-run·assignee 실패·Jira에서 되돌림) 재분류·재댓글·재전이 없이
  **assignee PUT만** 재시도한다. write 게이트 적용 — dry-run에서 live로 올리면 복원 시에도 Jira write가 발생할 수 있다.
- **분석 댓글은 분류된 모든 신규 bot-배정 티켓에 게시된다** — 자동 배정이 안 된 경우(≤80·unknown·owner 미등록·
  분류 중 상태 이동)에도 "자동 배정 없음" 사유를 담아 게시(write 게이트 적용). 전송 채널은 `SVP_COMMENT_CHANNEL`:
  `rest`(기본, 위 comment POST) / `mcp`(headless `claude -p`가 `SVP_COMMENT_MCP_NAME` MCP의 Jira 툴로 기입, 실패 시 REST 폴백).
- 댓글 템플릿(`server/jira.mjs buildComment`): `🤖 Sheriff Avatar 자동 분석` 헤더 + 분류/신뢰도/요약/참고 노트/배정 근거.

## 3. 서버 ↔ LLM (`server/classifier.mjs`)

| provider (`SVP_LLM_PROVIDER`) | 클라이언트 | 비고 |
|---|---|---|
| `bedrock` (기본) | `AnthropicBedrockMantle` (Messages) | `AWS_REGION` 필수. structured output(`output_config` json_schema) + adaptive thinking |
| `bedrock-invoke` | `AnthropicBedrock` (표준 InvokeModel) | structured output 미지원 — 프롬프트로 JSON 강제 후 파싱. 기본 모델은 global inference profile |
| `anthropic` | `Anthropic` (직접 API) | `SVP_ANTHROPIC_API_KEY` 필수 (사외 dev) |

모델은 `SVP_LLM_MODEL`(기본: provider별 Opus 4.8 ID), 타임아웃 `SVP_LLM_TIMEOUT_MS`(기본 30000, maxRetries 1).
자격증명 미설정 시 분류기 비활성 — 호출 없이 즉시 fallback. **세 호출 모두 절대 throw하지 않는다** — LLM 장애가
파이프라인을 멈추지 않고, 미분류 티켓은 당번 큐에 남는다.

| 호출 | 입력 | 출력 | 실패 시 fallback |
|---|---|---|---|
| `selectNotes` | 로그 발췌 + 노트 카탈로그(경로/제목/module/tags) | `{ hypothesis, files ≤3 }` — 카탈로그 밖 경로는 버림 | `{ hypothesis: '', files: [] }` → 키워드 매칭만 사용 |
| `classify` | 티켓 정보 + 로그(head 4000+tail 2000 캡) + 노트 본문(개당 3000자 캡) | `{ category, severity, confidence 0–100, summary, evidence }` — category는 vault 모듈 enum ∪ `unknown` | `{ category: 'unknown', confidence: 0 }` → 당번 유지 |
| `summarizeResolution` | 원본 로그 + 해결 코멘트(+ Gerrit 패치) | `{ symptom, cause, resolution }` — F7 ingest용 | symptom만 유지, cause/resolution `(불명)` |

프롬프트 원칙: confidence는 **wiki 근거 강도**만 반영(근거 없는 고신뢰 금지, >80 = "노트의 known-failure와
일치해 sheriff 리뷰 없이 배정 가능"), evidence는 실제 참조한 노트 경로만, summary는 한국어 2~3문장.
confidence는 프롬프트에 4구간 밴드로 캘리브레이션한다 — **85–95**: 노트가 이 실패를 그대로 문서화(같은 TC명·
에러 문자열·시그니처 — "a direct match MUST score above 80") / **65–80**: 모듈은 명확하나 이 실패 패턴은 미문서화 /
**51–64**: 약한 근거의 모듈 추정 / **≤50**: 근거 노트 없음(evidence 비움).
`classify` 응답은 structured output이어도 방어적으로 클램프한다: category가 모듈 enum 밖이면 `unknown`,
confidence는 0–100 정수로 클램프, severity가 enum 밖이면 이벤트 type 기반 폴백, evidence는 배열 강제.

## 4. 서버 ↔ Jenkins (`server/jenkins.mjs`, `server/ci-test-fetch.mjs`)

티켓 description에는 실패 로그가 없다 — 로그는 TEST 링크의 Jenkins 빌드에서 수집해 `event.log`에 보강한다.

1. `extractBuildUrl`로 티켓 텍스트에서 빌드 URL 추출 → `probeBuildUrl`(5xx/네트워크 실패면 수집 스킵).
2. **1차**: `.tool/Jenkins/fetch_ci_test.py` 직접 실행(python3, 사내 자산 — repo에 없음, 60초 타임아웃).
3. **폴백**: `fetchFailureLog` — 중계 빌드의 `api/json` description(500이면 HTML 페이지 — 이때 같은 잡의 히스토리
   링크는 제외)에서 `CI TEST RESULT :` 샤드 링크 수집 → 실패 샤드(`result !== 'SUCCESS'`)의 콘솔에서 해당 TC의
   `[ENABLE]` 실행 구간 추출, 못 찾으면 콘솔 꼬리(`SVP_JENKINS_LOG_TAIL`자). 추출 디테일:
   - 샤드 메타(result)는 **직렬로** 조회한다 — 병렬 버스트는 사내 게이트웨이가 차단.
   - TC명 매칭은 티켓의 도메인 접두사(`linux.` 등)를 제거한 변형도 함께 시도 (콘솔 마커에는 접두사가 없다).
   - 구간이 안전 상한 500KB(`SECTION_MAX`)를 넘으면 머리 1/3 + 꼬리 2/3로 압축 — `Test Result: FAIL`/`Fail Log:`
     판정이 구간 끝에 찍히므로 꼬리를 두껍게 남긴다. 상한 이내 구간은 통짜 보존.
   - 어느 샤드에서도 구간을 못 찾으면 각 샤드 콘솔 꼬리를 이어붙여 반환.
4. 확보한 로그는 `format-ci-log` 스킬(headless `claude -p`)로 양식화 — 실패하면 raw 그대로.

호출은 `node:http` 직통(프록시 우회 — Bedrock용 프록시가 내부 Jenkins를 차단), Basic auth
(`SVP_JENKINS_USER`/`SVP_JENKINS_TOKEN`), 재시도 1회. mock은 `mock/jenkins-server.mjs`(포트 8794, auth 없음).

## 5. mock 서버 (`mock/`)

### mock Jira 데모 엔드포인트 (`mock/jira-server.mjs`, 포트 8792)

§2 엔드포인트의 최소 부분집합(search·issue·comment·assignee·transitions) + 데모용:

- `POST /demo/trigger` body `{ "scenario": "...", "labels": ["svp-test"]? }` — 시나리오 티켓 즉시 생성.
  시나리오 6종: `auth-token-401` `payment-build` `snapshot-diff` `auth-lint` `payment-e2e` `infra-deploy`.
  `labels`는 기본 `ci-failure`에 추가(write-mode=label 검증용).
- `POST /demo/resolve` body `{ "key": "CIOPS-1234", "comment": "..." }` — 해결 코멘트 + Done 전이 (ingest 데모).
- `GET /demo/tickets` — 내부 티켓 전체(댓글·assignee·상태 검증용).
- `GET /browse/<KEY>` — 티켓 HTML 페이지 (앱의 "티켓 확인 ↗" CTA가 여는 링크).

### mock Jenkins 계약 (`mock/jenkins-server.mjs`, 포트 8794)

§4의 폴백 경로가 그대로 동작하도록 사내 2단 구조를 재현한다 (auth 없음):

- 티켓이 가리키는 `ci-<module>` 빌드(CI_MAIN_JOB 역할)의 `api/json` **description**에 `CI TEST RESULT :` 샤드 링크 —
  성공 샤드 `CI_TEST_pass`(`result: SUCCESS` — 실패 샤드 필터 검증용)와 실패 샤드 `CI_TEST_<module>`.
- 실패 샤드 콘솔은 실콘솔처럼 여러 TC가 `[ENABLE]` 마커로 직렬 실행되고 실패 구간 뒤에 진단 노이즈(`DIAG_NOISE`)가
  붙는 구조 — 구간 추출이 "노이즈 속 실패 구간"을 정확히 잘라오는지 검증한다.
- renderer-core 샤드는 콘솔 마커에 티켓 TC명에 없는 `I-` 접두사가 붙는 사내 실측 변형을 재현.

`mock/push-probe.mjs`는 앱 설치 없이 임의 사용자(admin/팀원)로 서버에 로그인해 push 프레임을 출력하는
멀티 유저 push 검증 도구다 (`node mock/push-probe.mjs <username> <durationMs>`).

## 6. 환경변수

서버·앱의 운영 환경변수. 클라이언트 앱의 필수 설정은 `SVP_PUSH_URL` 하나다
(선택: 표시 모드 `SVP_GLASS`, 공유 vault 경로 `SVP_WIKI_DIR`). 이 표 밖에서 AWS SDK 자격증명 체인 변수
(`AWS_PROFILE` 등 — `.env.example` 참고)는 SDK가 직접 읽는다.

| 변수 | 기본값 | 읽는 곳 |
|---|---|---|
| `SVP_PUSH_URL` | `http://localhost:8793` | 앱(`src/main/index.ts`) — 서버 Socket.IO 주소 |
| `SVP_GLASS` | (없음 — Win11 acrylic, 미만 solid) | 앱 — 배경 모드 `acrylic`/`solid`/`frameless` |
| `SVP_SERVER_PORT` / `SVP_SERVER_POLL_MS` | `8793` / `5000` | server — 리슨 포트 / 폴링 주기 |
| `SVP_JIRA_BASE_URL` / `SVP_JIRA_PAT` | `http://localhost:8792` / (없음) | server — Jira 주소 / Bearer PAT |
| `SVP_JIRA_JQL` / `SVP_JIRA_BOT` | `project = CIOPS AND labels = ci-failure` / `cicd_ap` | server — base JQL / bot 계정(= 사람 배정 전) |
| `SVP_JIRA_WRITE_MODE` / `SVP_TEST_LABEL` | `dry-run` / `svp-test` | server — 쓰기 게이트(§2) |
| `SVP_LLM_PROVIDER` / `SVP_LLM_MODEL` / `SVP_LLM_TIMEOUT_MS` | `bedrock` / provider별 / `30000` | classifier (§3) |
| `AWS_REGION` / `SVP_ANTHROPIC_API_KEY` | (없음) | classifier — provider별 자격증명. 미설정 = 분류기 off |
| `SVP_LLM_CONFIDENCE_MIN` | `80` | server — 자동 배정 게이트(strictly greater) |
| `SVP_FORCE_ASSIGNEE` | (없음 — 정상 동작) | server — auto-assign 대상을 wiki owner 대신 이 사용자로 고정하는 **테스트 오버라이드** (confidence 게이트는 유지). 설정 시 기동 로그에 `⚠ FORCE_ASSIGNEE=...` 경고 — 운영에서는 비워둔다 |
| `SVP_COMMENT_CHANNEL` / `SVP_COMMENT_MCP_NAME` | `rest` / (없음) | comment-channel (§2) |
| `SVP_JENKINS_USER` / `SVP_JENKINS_TOKEN` | (없음 — mock은 불필요) | jenkins — Basic auth |
| `SVP_JENKINS_TIMEOUT_MS` / `SVP_JENKINS_LOG_TAIL` | `15000` / `6000` | jenkins — 요청 타임아웃 / 꼬리 폴백 크기 |
| `SVP_WIKI_DIR` | `<repo>/wiki-vault` | wiki-query·ingest·wiki-lint + 앱(`src/main/modules/wiki/`) — vault 경로 |
| `SVP_INGEST_MODE` / `SVP_DEDUP_WINDOW_DAYS` | `dry-run` / `14` | ingest — vault 쓰기 게이트 / case-log 중복 창 |
| `SVP_RECUR_BOOST_CAP` / `SVP_FEEDBACK_DEMOTE` | `4` / `3` | wiki-query — 재발 가점 상한 / 👎 감점 |
| `SVP_DEBUG_DUMP_DIR` | (없음 — 꺼짐) | server — 신규 티켓 수집 로그 덤프 |

표 밖의 고정 타임아웃(환경변수 아님 — 코드 상수): CI tool 60초·format 스킬 180초(`ci-test-fetch.mjs`),
MCP 댓글 120초(`comment-channel.mjs`), `wiki:lint` ack 10초(클라이언트), 앱 로그인 8초(`src/main/index.ts`).

