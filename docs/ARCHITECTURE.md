# SVP 아키텍처 (v2 — 클라이언트·서버 + Jira 중심)

> 이 문서는 **목표 구조**를 명세한다. 현재 코드(스켈레톤)는 단일 앱 + mock CI WebSocket 직결 구조이며,
> 차이는 마지막 [현재 구현과의 차이](#현재-구현과의-차이) 참고.
> 세부 명세: [API.md](./API.md) (프로토콜), [BACKEND.md](./BACKEND.md) (백엔드 기능), [DEMO-SCENARIO.md](./DEMO-SCENARIO.md) (데모).

## 토폴로지

- **C(당번) 앱 = 서버 겸용.** 당번 PC의 Sheriff Avatar가 대시보드 UI와 함께 백엔드 전체
  (Jira 폴링 → LLM 분류 → 배정 → Jira 댓글 → 클라이언트 push → WIKI 관리)를 실행한다.
- **A, B(일반 팀원) 앱 = 클라이언트.** 서버에 WebSocket으로 접속해 **자기에게 배정된 이슈만** 받는다.
  클라이언트는 Jira·WIKI·LLM에 직접 접근하지 않는다 — 모든 것은 서버 경유.
- 이슈의 유입은 **Jira 티켓 폴링**이 메인이다. 사내 CI/CD가 실패 시 Jira 티켓을 자동 생성하고(기존 사내 인프라),
  서버가 Jira REST API를 주기 폴링해 신규 티켓을 감지한다.

```mermaid
flowchart LR
    CI["사내 CI/CD"] -- "실패 → 티켓 자동 생성" --> JIRA[("사내 Jira")]
    subgraph SERVER["당번(C) PC — Sheriff Avatar 서버 모드"]
        POLLER["jira/ 폴러"] --> CLS["classifier/<br/>LLM 분류 (신뢰도 0~100)"]
        WIKI[("wiki-vault/")] -- "query" --> CLS
        CLS --> ROUTER["assignment/ 라우터"]
        ROUTER --> HUB["hub/ 클라이언트 WS 서버"]
        ROUTER --> DASH["당번 대시보드 UI"]
        POLLER -- "Done 확정 → LLM ingest" --> WIKI
    end
    JIRA -- "REST 폴링 (신규/상태변경)" --> POLLER
    ROUTER -- "요약 댓글 + assignee 지정" --> JIRA
    HUB -- "issue:assigned" --> A["클라이언트 A<br/>(컴팩트 창 + 팝업)"]
    HUB -- "issue:assigned" --> B["클라이언트 B<br/>(컴팩트 창 + 팝업)"]
    A -- "ack / resolve / feedback" --> HUB
    B -- "ack / resolve / feedback" --> HUB
```

## 데이터 흐름 (이슈 하나의 사이클)

1. 사내 CI/CD 실패 → **Jira 티켓 자동 생성** (label: `ci-failure` — 기존 사내 인프라)
2. 서버가 Jira를 폴링해 신규 티켓 감지 (기본 30초 주기, 처리 완료 키는 중복 방지 저장)
3. **query** — 티켓의 summary/description/로그로 `wiki-vault/` 검색 (known-failure, 과거 case-log 포함)
4. **classify** — LLM이 티켓 내용 + 매치된 wiki 노트를 읽고 `{category, severity, confidence, summary}` 산출
5. **route** — 신뢰도 **>80**: 해당 모듈 담당자 / **≤80**: 당번 (human-in-the-loop, 당번이 수동 재배정 가능)
6. **Jira 댓글** — 서버가 티켓에 요약 댓글(분류·신뢰도·추정 원인·참고 wiki·배정 근거)을 달고 assignee를 지정
7. **push** — 배정된 팀원의 클라이언트로 `issue:assigned` 전송 → 우하단 팝업. 당번 대시보드에는 전체 이슈 표시
8. 담당자 처리 → **Jira에서 해결 코멘트 + Done 전이** (또는 앱의 "해결 완료" → 서버가 전이 호출) → 폴링으로 Done 확인
9. **ingest** — Done 확정 시 **LLM이 Jira 해결 코멘트를 근거로 `case-log.md` 항목을 작성** + `index.md`/`log.md` 갱신
   → **다음 같은 유형 이슈의 신뢰도가 올라간다** (compounding)
10. **feedback/lint** — 담당자의 노트 👍/👎, 당번의 주기 점검으로 저품질 노트 정리. Done 확정 시 서버가 담당자 앱에
    "참조 노트가 도움됐나요?" toast를 push해 피드백 접점을 유지한다 (해결이 Jira로 이동해도 피드백 루프 보존)

## 상태 관리 — Jira가 source of truth

| 앱 상태 | Jira 상태 (statusCategory) | 전이 주체 |
|---|---|---|
| `new` | To Do (Open) | CI/CD가 티켓 생성 |
| `acknowledged` | In Progress | 담당자가 앱에서 "확인" → 서버가 transition 호출 |
| `resolved` | Done | 담당자가 **Jira에서 직접 Done 처리** (기본 경로) 또는 앱 "해결 완료" → 폴링으로 확정 |

- 담당자가 Jira에서 직접 상태를 바꿔도 서버가 폴링으로 감지해 앱에 반영한다 (양방향 동기화, Jira 우선).
- ingest는 **Jira에서 Done이 확인된 시점**에 1회만 수행한다.

## 가시성 규칙 & 뷰 모드

- **서버 측 필터링**: 클라이언트에는 애초에 자기 이슈만 push된다 (v1 스켈레톤의 renderer 필터링을 대체).
- role = `member` (클라이언트): 컴팩트 창(420×640) — 배정 이슈만 표시/알림
- role = `sheriff` (서버): 전체 대시보드(1180×760) — 팀 전체 이슈 + WIKI 점검 + 수동 재배정
- 모드는 설정으로 결정: `role=sheriff` → 서버 모드로 기동, `role=member` → `SVP_SERVER_URL`로 접속

## 모듈 맵 (목표)

```
src/main/
  modules/jira/            Jira 폴링·댓글·assignee·transition (신규, F1·F5·F7)
  modules/classifier/      LLM 분류 — Claude API (stub → 실구현)
  modules/wiki/            LLM-WIKI 4대 동작 (query/ingest/lint/feedback — 서버 전용)
  modules/assignment/      신뢰도 라우팅 + 당번 수동 재배정
  modules/hub/             클라이언트 WS 서버 — 세션 관리·push (신규, F6)
  modules/hub-client/      클라이언트 모드의 서버 접속 (신규, 기존 websocket/ 대체)
  modules/notifications/   toast (양쪽 공통)
```

- 서버 모드: `jira/ classifier/ wiki/ assignment/ hub/` 활성. 클라이언트 모드: `hub-client/ notifications/`만 활성.
- 모듈 간 통신은 `src/shared/types.ts` 타입으로만 — 기존 규칙 유지.

## wiki 4대 동작 (서버 전용)

| 동작 | 트리거 | 하는 일 |
|---|---|---|
| query | 신규 티켓 감지 시 자동 | 관련 노트 검색, 부정 피드백 노트는 감점 |
| ingest | Jira Done 확정 시 자동 (1회) | **LLM이 Jira 해결 코멘트를 근거로 case-log 작성**, index/log 갱신 |
| lint | 당번의 "WIKI 점검" 버튼 | 고아 노트·부정 피드백 노트 보고 |
| feedback | 클라이언트의 노트 👍/👎 (hub 경유) + Done 확정 시 피드백 toast | 유용성 투표 저장 (👎3+ → query 감점) |

- ingest 중 LLM이 "참조 노트가 가리킨 원인 ≠ 실제 해결 내용"을 감지하면 **lint 보고로만** 전달한다.
  query 감점은 사람의 👍/👎 투표만 반영 — LLM 판단은 노이즈가 있어 보조 신호로만 쓴다.
- Jira는 reopen이 가능하므로 ingest 1회 규칙에는 처리 완료 키 기록이 필요하다 (reopen → 재해결 시 중복 기록 방지).

## 현재 구현과의 차이

| 영역 | 현재 (스켈레톤) | 목표 (이 문서) |
|---|---|---|
| 배포 형태 | 전원 동일 앱, 역할은 화면 전환 | C = 서버 겸용, A/B = 클라이언트 |
| 이슈 유입 | CI가 WebSocket으로 직접 push (`mock:ci`) | Jira 티켓 폴링 (개발은 mock Jira — [API.md §4](./API.md)) |
| 분류 | stub (wiki 매치 점수 기반 가짜 신뢰도) | Claude API 실호출 |
| 필터링 | renderer에서 클라이언트 측 필터 | 서버 측 필터 (자기 이슈만 push) |
| 상태 | 앱 로컬 (in-memory) | Jira가 source of truth, 폴링 동기화 |
| Jira 댓글 | 없음 | 배정 시 요약 댓글 자동 |

기존 `mock/ci-server.mjs`와 `modules/websocket/`은 mock Jira 서버·`hub-client/`로 대체될 때까지 개발용으로 유지한다.
