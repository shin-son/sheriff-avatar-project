# SVP API 명세

> 대상 구조는 [ARCHITECTURE.md](./ARCHITECTURE.md) 참고. 이 문서는 3개 경계의 프로토콜을 명세한다:
> **① 클라이언트 ↔ 서버(WS)**, **② 서버 ↔ Jira(REST)**, **③ 서버 ↔ Claude API(LLM)**. ④는 개발용 mock Jira.
> payload의 타입은 `src/shared/types.ts`를 따른다 (필요한 타입 확장은 [§5](#5-sharedtypests-확장-제안)).

## 1. 클라이언트 ↔ 서버 (WebSocket)

- 서버(당번 앱)가 `ws://<sheriff-host>:8791` 리슨. 포트는 `SVP_HUB_PORT`로 변경 가능.
- 클라이언트는 `SVP_SERVER_URL` (예: `ws://192.168.0.10:8791`)로 접속. 끊기면 3초 간격 재접속 (기존 정책 유지).
- 인증: **v1은 사내망 신뢰 기반으로 `clientId`만** 사용. 토큰 인증은 Week 3 재검토 (TODO(SVP-5)).

### 메시지 envelope

모든 메시지는 JSON 텍스트 프레임 하나:

```json
{ "v": 1, "type": "issue:assigned", "ts": "2026-07-20T09:00:00Z", "payload": { } }
```

`v`는 프로토콜 버전(현재 1). 모르는 `type`은 무시한다 (전방 호환).

### 메시지 목록

| 방향 | type | payload | 설명 |
|---|---|---|---|
| C→S | `client:hello` | `{ clientId, appVersion }` | 접속 직후 1회. 서버는 `server:welcome`으로 응답 |
| S→C | `server:welcome` | `{ user: UserConfig, team: TeamMember[], issues: SheriffIssue[] }` | 해당 클라이언트에 배정된 이슈 스냅샷 (재접속 시 상태 복원) |
| S→C | `issue:assigned` | `{ issue: SheriffIssue }` | 새 이슈 배정 push — **본인 배정분만 전송** |
| S→C | `issue:updated` | `{ issue: SheriffIssue }` | 상태 변경·재배정 반영. 재배정으로 자신이 제외되면 `issue.assignment`로 판별해 목록에서 제거 |
| C→S | `issue:ack` | `{ issueId }` | "티켓 확인" 클릭(티켓 열림과 동시) → 서버가 Jira를 In Progress로 전이. **해결 메시지는 없다** — Done은 Jira에서만 일어나고 서버가 폴링으로 감지한다 |
| C→S | `wiki:feedback` | `{ noteTitle, helpful: boolean }` | 참조 노트 👍/👎 (서버의 feedback 저장소에 기록) |
| S→C | `server:error` | `{ code, message }` | 요청 처리 실패 (예: `JIRA_TRANSITION_FAILED`) — 클라이언트는 토스트로 표시 |

- 하트비트: WS 표준 ping/pong, 서버가 30초 주기. 2회 무응답 시 세션 종료(클라이언트는 재접속 루프 진입).
- `client:hello`의 `clientId`가 `TEAM`에 없으면 서버는 `server:error(UNKNOWN_CLIENT)` 후 연결 종료.
- 당번 대시보드는 같은 프로세스이므로 이 프로토콜을 쓰지 않고 기존 IPC(`window.svp`)를 그대로 쓴다.

## 2. 서버 ↔ Jira (REST)

- 사내 Jira Server/DC 기준 REST v2. 인증은 PAT(Bearer 토큰).
- 환경변수 (`.env`, gitignore 대상 — 절대 커밋 금지):

| 변수 | 예시 | 설명 |
|---|---|---|
| `SVP_JIRA_BASE_URL` | `https://jira.example.internal` | Jira 베이스 URL |
| `SVP_JIRA_PAT` | `(secret)` | Personal Access Token |
| `SVP_JIRA_PROJECT` | `CIOPS` | 감시 대상 프로젝트 키 |
| `SVP_JIRA_LABEL` | `ci-failure` | CI 자동 생성 티켓 식별 라벨 |
| `SVP_JIRA_POLL_MS` | `30000` | 폴링 주기 (기본 30초) |

### 사용 엔드포인트

| 용도 | 호출 | 비고 |
|---|---|---|
| 신규 티켓 폴링 | `GET /rest/api/2/search` JQL: `project={PROJECT} AND labels={LABEL} AND created >= "{lastPoll}" ORDER BY created ASC` | fields: `summary,description,labels,status,created,assignee` |
| 티켓 상세 | `GET /rest/api/2/issue/{key}` | CI 로그가 description 또는 첨부에 있음 — 스키마는 사내 확인 후 확정 (TODO(SVP-6)) |
| 요약 댓글 | `POST /rest/api/2/issue/{key}/comment` | 아래 댓글 템플릿 |
| 담당자 지정 | `PUT /rest/api/2/issue/{key}/assignee` | `{ "name": "<jira-username>" }` — `TeamMember`에 `jiraUsername` 매핑 필요 |
| 상태 전이 | `POST /rest/api/2/issue/{key}/transitions` | 전이 ID는 `GET .../transitions`로 조회 후 statusCategory로 매칭 |
| 해결/변경 감지 | 폴링 JQL: `key in ({추적 중인 키들}) AND updated >= "{lastPoll}"` | Done 확인 시 ingest 트리거 |

- **중복 방지**: 처리한 티켓 키를 `userData/svp-processed-tickets.json`에 영속화. 서버 재시작 시에도 재분류하지 않는다.
- **장애 정책**: Jira 응답 실패 시 지수 백오프(최대 5분), 파이프라인은 계속 동작. 댓글/전이 실패는 재시도 1회 후
  당번 대시보드에 경고 표시 (이슈 배정 자체는 실패시키지 않는다).

### Jira 요약 댓글 템플릿

```
🤖 Sheriff Avatar 자동 분석
─────────────────────────
■ 분류: {category} / {event.type} / {severity}
■ 신뢰도: {confidence}/100 → {배정 결과: "auth 담당 Alice 자동 배정" | "당번 확인 필요"}
■ 요약: {LLM summary — 담당자가 로그를 열기 전에 상황을 파악할 수 있는 2~3문장}
■ 참고 (LLM-WIKI):
  - {wikiRefs[].title} — {한 줄 근거}
■ 배정 근거: {assignment.reason}
```

- 댓글은 티켓당 **배정 시 1회**. 재배정 시 갱신 댓글 1회 추가.

## 3. 서버 ↔ Claude API (LLM 분류)

`classifier/`가 담당. 모델·프롬프트 세부는 Week 2 구현 시 확정하되, 계약은 다음과 같다.

- **입력**: 티켓 정보(summary, description, CI 로그 발췌 — 로그는 앞뒤 잘라 토큰 제한 내로) + `queryWiki()` 상위 3개 노트 본문
- **출력**: 아래 JSON만 (structured output 강제):

```json
{
  "category": "auth",
  "severity": "major",
  "confidence": 86,
  "summary": "token refresh 시 401 — auth.md의 known-failure #2와 동일 패턴. 세션 갱신 로직 회귀로 추정.",
  "evidence": ["modules/auth.md"]
}
```

- `category`는 `TEAM[].ownedModules`에 존재하는 값 또는 `"unknown"`. `confidence`는 wiki 근거 강도를 반영해야 한다
  (근거 없는 고신뢰 금지 — 프롬프트에 명시).
- **fallback**: API 호출 실패·파싱 실패·타임아웃(30초) 시 `{ category: "unknown", confidence: 0 }`으로 처리
  → 자동으로 당번 배정. **LLM 장애가 파이프라인을 멈추지 않는다.**
- API key는 `.env`(`SVP_ANTHROPIC_API_KEY`). 사내망에서는 프록시 경유 여부를 Week 2에 확인.

## 4. mock Jira 서버 (개발·데모용)

`mock/jira-server.mjs` (신규, 기존 `mock/ci-server.mjs` 대체 예정) — 포트 **8792**.
서버가 사용하는 위 엔드포인트의 최소 부분집합만 구현한다:

- `GET /rest/api/2/search` — 시드 티켓 + 트리거된 티켓 반환 (JQL은 created/updated 시각만 해석)
- `GET /rest/api/2/issue/{key}` / `POST .../comment` / `PUT .../assignee` / `POST .../transitions`
- 데모 트리거: `POST /demo/trigger` body `{ "scenario": "auth-token-401" | "payment-build" | "snapshot-diff" | ... }`
  → 해당 시나리오 티켓을 즉시 생성 (데모 진행자가 curl로 호출, [DEMO-SCENARIO.md](./DEMO-SCENARIO.md) 참고)
- 데모 해결: `POST /demo/resolve` body `{ "key": "CIOPS-1234", "comment": "token refresh 재시도 로직 수정" }`
  → 티켓에 해결 코멘트를 달고 상태를 Done으로 전이. 담당자가 실제 Jira에서 resolve하는 행위를 재현하며,
  서버가 폴링으로 감지해 ingest를 트리거하는 흐름을 데모에서 보여주기 위한 것 (DEMO-SCENARIO.md 장면 2)
- 받은 댓글·assignee·상태는 메모리에 유지해 `GET /demo/tickets`로 확인 가능 (데모에서 "Jira에 댓글 달렸다" 검증용)

## 5. shared/types.ts 확장 (제안)

```ts
// 이슈 출처: Jira 티켓이 메인, mock CI는 개발용으로 당분간 병존
export type IssueSource = 'jira' | 'mock-ci'

export interface JiraTicketRef {
  key: string        // 예: CIOPS-1234
  url: string
  status: string     // Jira statusCategory: 'new' | 'indeterminate' | 'done'
}

// SheriffIssue에 추가
//   source: IssueSource
//   jira?: JiraTicketRef

// TeamMember에 추가
//   jiraUsername: string   // assignee 지정용
```
