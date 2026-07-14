# SVP 백엔드 핵심 기능 명세

> 서버(= 당번 앱의 백엔드)가 제공해야 하는 기능을 F1~F8로 정의한다.
> 구조는 [ARCHITECTURE.md](./ARCHITECTURE.md), 프로토콜 세부는 [API.md](./API.md) 참고.
> 각 기능은 "완료 기준"이 통과해야 done으로 간주한다 (검증 가능한 목표 — CLAUDE.md 작업 원칙).

## 기능 목록

| # | 기능 | 모듈 | 상태 |
|---|---|---|---|
| F1 | Jira 폴러 (이슈 유입) | `modules/jira/` | 신규 |
| F2 | WIKI query (분류 근거 검색) | `modules/wiki/` | 구현됨 (키워드) → 정확도 개선 |
| F3 | LLM 분류기 | `modules/classifier/` | stub → Claude API 실구현 |
| F4 | 배정 라우터 + 수동 재배정 | `modules/assignment/` | 라우팅 구현됨 → 재배정 추가 |
| F5 | Jira 라이터 (댓글·assignee·전이) | `modules/jira/` | 신규 |
| F6 | 클라이언트 허브 (WS 서버) | `modules/hub/` | 신규 |
| F7 | 해결 감지 → WIKI ingest | `modules/jira/` + `modules/wiki/` | ingest 구현됨 → Jira 연동 |
| F8 | WIKI 위생 (lint / feedback) | `modules/wiki/` | 구현됨 → 규칙 고도화 |

## F1 — Jira 폴러

- **책임**: `SVP_JIRA_POLL_MS` 주기로 신규 `ci-failure` 티켓과 추적 중 티켓의 상태 변경을 감지해 파이프라인에 전달.
- **입력**: Jira search API. **출력**: 정규화된 이슈 이벤트 (`shared/types.ts`).
- **불변 조건**:
  - 티켓 하나는 **정확히 한 번만** 분류된다 (처리 키 영속화 — 서버 재시작에도 유지).
  - Jira 다운 시 지수 백오프로 버티고, 복구되면 놓친 티켓을 `created >= lastPoll`로 따라잡는다.
- **완료 기준**: mock Jira에 티켓 3개 생성 → 전부 정확히 1회씩 분류됨. 폴러 중단 후 재시작 → 중복 분류 0건.

## F2 — WIKI query

- **책임**: 티켓 텍스트로 `wiki-vault/`에서 관련 노트 상위 3개 검색. **case-log도 검색 대상** — 이것이 compounding의 핵심
  (해결 사례가 쌓일수록 같은 유형의 매치 점수가 올라간다).
- **현재**: 키워드 매칭 + 부정 피드백 감점. **개선(Week 1, 김민석)**: frontmatter 스키마 확정, 검색 정확도.
- **완료 기준**: auth 토큰 이슈 티켓 → `modules/auth.md`가 1위 매치. 👎3 누적 노트는 점수 반감 확인.

## F3 — LLM 분류기 (Claude API)

- **책임**: 티켓 + wiki 노트를 읽고 `{category, severity, confidence, summary, evidence}` 산출 ([API.md §3](./API.md) 계약).
- **핵심 규칙**:
  - `confidence`는 wiki 근거 강도에 비례해야 한다. **근거 없이 80점을 넘기지 않는다** (프롬프트로 강제 + 상한 로직).
  - `summary`는 담당자가 로그를 열기 전에 상황 파악이 되는 한국어 2~3문장. Jira 댓글에 그대로 들어간다.
  - LLM 실패 시 `confidence: 0` fallback — **파이프라인은 절대 멈추지 않는다.**
- **완료 기준**: mock 시나리오 6종에 대해 wiki 근거가 있는 이슈는 >80, 처음 보는 유형은 ≤80으로 분류됨.
  API key를 제거하고 실행해도 이슈가 당번에게 정상 배정됨.

## F4 — 배정 라우터 + 수동 재배정

- **책임**: 신뢰도 >80 → `category` 담당자, ≤80 → 당번 (기존 로직 유지).
  **추가(Week 2, 김병재)**: 당번 대시보드에서 이슈를 다른 팀원에게 수동 재배정 (human-in-the-loop의 손).
- **재배정 시**: hub가 기존/신규 담당자 양쪽에 `issue:updated` push, Jira assignee 갱신 + 갱신 댓글 1회.
- **완료 기준**: ≤80 이슈를 당번이 B에게 재배정 → B 클라이언트에 팝업, A/당번 화면에서 상태 일치, Jira assignee 변경됨.

## F5 — Jira 라이터

- **책임**: 배정 확정 시 요약 댓글 작성 + assignee 지정, ack/resolve 시 상태 전이 ([API.md §2](./API.md)).
- **불변 조건**: 댓글은 티켓당 배정 1회 + 재배정 시 1회. 쓰기 실패는 재시도 1회 후 당번에게 경고 — 배정 자체는 실패시키지 않는다.
- **완료 기준**: mock Jira의 `GET /demo/tickets`에서 댓글·assignee·상태가 시나리오대로 기록됨.

## F6 — 클라이언트 허브

- **책임**: `ws://:8791` 리슨, 클라이언트 세션 관리(hello/welcome, 하트비트), **서버 측 필터링** push.
- **공개 API (서버 내부 계약 — 같은 프로세스의 F1 파이프라인이 TypeScript import로 호출)**:

  ```ts
  // src/main/modules/hub/ — 타입은 @shared/types의 SheriffIssue만 사용
  startHub(opts: {
    port?: number                                        // 기본 8791 (SVP_HUB_PORT)
    getIssuesFor: (clientId: string) => SheriffIssue[]   // server:welcome 스냅샷용 — 이슈 저장소는 파이프라인 소유
  }): void
  pushIssue(issue: SheriffIssue): void       // 분류·배정 완료된 신규 이슈 → 담당자에게 issue:assigned
  notifyUpdated(issue: SheriffIssue): void   // 상태 변경·재배정 → issue:updated
                                             // (재배정으로 제외된 기존 담당자에게도 전송 — 클라이언트가 목록에서 제거)
  ```

  - 파이프라인(F1→F3→F4)은 배정 확정 후 `pushIssue()` 한 번만 호출하면 된다.
    당번 대시보드 반영은 hub 경유가 아니라 기존 IPC(`webContents.send`)로 별도 호출.
  - **W2 예고**: C→S 메시지(`issue:ack`)가 들어오면 `startHub`에 `onAck(clientId, issueId)` 핸들러가 추가된다.
- **불변 조건**:
  - 클라이언트에는 자기에게 배정된 이슈만 나간다. 전체 목록은 당번 대시보드(같은 프로세스, IPC)에만 존재.
  - 클라이언트 재접속 시 `server:welcome`으로 미해결 배정분 전체를 복원한다 — 오프라인 중 배정을 잃지 않는다.
- **완료 기준**: A 접속 끊고 A에게 이슈 배정 → A 재접속 시 해당 이슈가 복원되어 표시됨. B에게는 A의 이슈가 보이지 않음.

## F7 — 해결 감지 → WIKI ingest

- **책임**: 티켓이 Done으로 확정된 시점에 LLM이 Jira 해결 코멘트를 근거로 case-log를 작성 (+ index/log 갱신), 1회만.
- 해결 경로는 **Jira에서 Done 처리가 유일** — 앱에는 해결 버튼이 없다 ([ARCHITECTURE.md](./ARCHITECTURE.md) 데이터 흐름 8단계).
- **완료 기준**: Jira Done 처리 시 case-log에 정확히 1건 기록. 같은 티켓을 Done↔Reopen 반복해도 중복 ingest 없음.

## F8 — WIKI 위생 (lint / feedback)

- **책임**: Done 확정 시 담당자에게 "참조 노트의 원인 = 실제 원인?" **일치/불일치** toast를 push하고, 판정이 hub 경유로
  서버 저장소에 쌓이도록 배선 ([ARCHITECTURE.md](./ARCHITECTURE.md) wiki 4대 동작). Week 2에 감점 임계값 고도화 (김민석).
- **완료 기준**: A 클라이언트에서 불일치 판정 3회 → 당번의 lint 보고서에 해당 노트가 정리 후보로 표시됨.

## PLAN.md 매핑 (확정 — [PLAN.md](./PLAN.md)에 반영됨)

| 담당 | Week 1 | Week 2 |
|---|---|---|
| 김병재 | **F1 (jira/ 폴러 + 처리 티켓 중복 방지 테이블)** | F4 재배정 |
| 손신 | **F6 (hub/ — push 전용 채널)** | F3 (classifier LLM) |
| 김민석 | **클라이언트 (hub-client/ + push 수신 화면 구성)** | F7·F8 |

- F5(Jira 라이터)와 F2(wiki query 개선 + `jiraUsername` 매핑)는 W1 재편으로 담당 미정 —
  주간 회고에서 W2 편입을 정한다 (F2의 jiraUsername 매핑은 F5 assignee 지정의 전제 조건).
