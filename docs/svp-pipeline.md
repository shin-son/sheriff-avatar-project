# SVP v3 파이프라인 — PR #15 / #16 / #17 통합 동작 구조

CI/CD 실패가 Jira 티켓이 되고 → 서버가 폴링·분류·배정하고 → 해결되면 LLM-WIKI로 축적되어
다음 분류가 더 정확해지는 전체 흐름. 세 PR을 색으로 구분한다.

## 색상 범례

| 색 | 범위 |
|---|---|
| 🟩 초록 | **#15** raw 3-소스 스키마 (jira/ci/gerrit + correlation key) |
| 🟦 파랑 | **#16** ingest — 해결 티켓을 vault로 동결·기록 |
| 🟧 주황 | **#17** Jenkins 실패 로그 수집 + 실티켓 계약 파싱 |
| ⬜ 회색 | 기존 v3 서버 (이미 구현됨) |
| 🟨 노랑 | 외부 시스템 / 클라이언트 |
| 🟪 보라 | LLM |

## 전체 파이프라인

```mermaid
flowchart TB
  classDef pr15 fill:#d5e8d4,stroke:#82b366,color:#000
  classDef pr16 fill:#dae8fc,stroke:#6c8ebf,color:#000
  classDef pr17 fill:#ffe6cc,stroke:#d79b00,color:#000
  classDef base fill:#f5f5f5,stroke:#666666,color:#000
  classDef ext  fill:#fff2cc,stroke:#d6b656,color:#000
  classDef llm  fill:#e1d5e7,stroke:#9673a6,color:#000

  subgraph EXT["외부 시스템 · 클라이언트"]
    JIRA[("Jira 사내<br/>description = ' : ' key-value<br/>로그 없음 · TEST 링크는 Jenkins")]
    RELAY["Jenkins CI_MAIN_JOB 중계빌드<br/>api/json description 안에<br/>CI TEST RESULT 샤드 링크"]
    SHARD["Jenkins CI_TEST 샤드빌드 (복수)<br/>console 약 9MB · 수백 TC 직렬<br/>ENABLE n/m tc.sh 마커<br/>Test Result FAIL · Fail Log"]
    GERRIT["Gerrit (후속 · 미구현)<br/>changes/id/revisions/current/patch"]
    CLIENT["클라이언트 Electron 앱<br/>로그인 · 역할 · push 수신 · toast · ack"]
    LLMN["LLM<br/>Bedrock · Bedrock-invoke · Anthropic<br/>자격증명 없으면 fallback"]
  end

  subgraph SRV["SVP v3 서버 (server/*.mjs · headless Node · systemd)"]
    POLL["index.mjs poll() 5초 주기<br/>1) 신규 티켓 base JQL 검색<br/>2) 추적 티켓 status/assignee sync"]
    NORM["normalize(t) — 실티켓 계약 (PR17)<br/>Step→type · CICD Project→branch<br/>module=unknown (LLM 몫) · log=description"]
    JENK["jenkins.mjs (PR17)<br/>extractBuildUrl → CI_MAIN_JOB URL<br/>fetchFailureLog: 샤드링크 → 실패샤드 필터<br/>console → tcSectionIn TC구간 → 없으면 꼬리"]
    ENRICH["event.log += jenkins.log (PR17)<br/>event.url = jenkins.url<br/>분류 입력 보강"]
    WQ["wiki-query.mjs queryWiki<br/>키워드 스코어 상위 3<br/>listModules → enum · resolveOwner → owner"]
    CLS["classifier.mjs classify<br/>category · severity · confidence 0-100<br/>summary · evidence (구조화 출력 + fallback)"]
    ROUTE["classifyAndAct · routeByAssignee<br/>confidence 80 초과 → owner 자동 배정<br/>80 이하 → 당번(sheriff) 큐"]
    JWRITE["jira.mjs write<br/>setAssignee → postComment → transitionTo<br/>WRITE_MODE 게이트 (dry-run 기본)"]
    PUSH["Socket.IO push (서버측 필터)<br/>issue:new · issue:updated → 대상 세션"]
    TRIG["sync: resolved 진입 + 미ingest 확인 (PR16)<br/>→ void ingestResolved (fire-and-forget)"]
    GETRAW["jira.mjs getIssueRaw (PR16)<br/>fields=description,comment"]
    SUMM["classifier.mjs summarizeResolution (PR16)<br/>LLM: symptom · cause · resolution<br/>무자격이면 symptom만"]
    INGEST["ingest.mjs ingestResolved (PR16)<br/>INGEST_MODE 게이트 · 멱등 raw/jira 존재<br/>freeze raw · appendCaseLog · rebuildIndex"]
  end

  subgraph VAULT["LLM-WIKI vault (wiki-vault/)"]
    MOD["modules/module.md<br/>known-failure 지식노트 · owner 맵"]
    CASE["case-log.md (PR16 append)<br/>해결 사례 원장 (건별)"]
    IDX["index.md · log.md (PR16)<br/>카탈로그 · 연대기 (raw 제외)"]
    RJIRA["raw/jira (PR15)<br/>description + resolution comments"]
    RCI["raw/ci (PR15)<br/>Failed tests + Jenkins 로그 발췌"]
    RGERRIT["raw/gerrit (PR15 · 후속)<br/>changed files + diff"]
  end

  JIRA -->|"1) REST search (JQL)"| POLL
  POLL -->|"신규 티켓"| NORM
  NORM --> JENK
  JENK -.->|"api/json · consoleText"| RELAY
  RELAY -.->|"CI TEST RESULT 링크"| SHARD
  SHARD -.->|"실패 샤드 TC 구간"| JENK
  JENK --> ENRICH
  ENRICH --> WQ
  MOD -.->|"query 대상 · owner 맵"| WQ
  WQ -->|"matches 상위 3"| CLS
  CLS -.-> LLMN
  CLS --> ROUTE
  ROUTE -->|"80 초과 자동 배정"| JWRITE
  JWRITE -->|"assignee·댓글·전이 write"| JIRA
  ROUTE --> PUSH
  PUSH -->|"issue push · ack"| CLIENT

  POLL -->|"2) resolved 전이"| TRIG
  TRIG --> GETRAW
  GETRAW -.->|"description + comments"| JIRA
  GETRAW --> SUMM
  SUMM -.-> LLMN
  SUMM -->|"filled 필드"| INGEST
  INGEST --> CASE
  INGEST --> IDX
  INGEST -->|"freeze"| RJIRA
  INGEST -->|"freeze"| RCI
  CASE -.->|"반복 사례 → known-failure 승격 (F7 후속)"| MOD
  MOD -.->|"축적 → 다음 분류 신뢰도 상승 (compounding)"| WQ

  class NORM,JENK,ENRICH pr17
  class TRIG,GETRAW,SUMM,INGEST,CASE,IDX pr16
  class RJIRA,RCI,RGERRIT pr15
  class POLL,WQ,CLS,ROUTE,JWRITE,PUSH,MOD base
  class JIRA,RELAY,SHARD,GERRIT,CLIENT ext
  class LLMN llm
```

## 두 갈래 흐름

**① INBOUND — 신규 티켓 (주황 #17이 핵심)**

`poll()`이 base JQL로 신규 티켓을 잡으면 `normalize()`가 실티켓 description(`' : '` key-value)을
파싱한다. description에는 로그가 없으므로 **`jenkins.mjs`(#17)** 가 TEST 링크의 CI_MAIN_JOB
중계빌드 → `CI TEST RESULT` 샤드빌드(build description의 api/json) → 실패 샤드(result ≠ SUCCESS)
console에서 해당 TC의 `[ENABLE]` 구간만 추출해 `event.log`를 보강한다. 이 보강된 로그가
wiki query → classifier(LLM)의 입력이 되고, confidence 80 초과면 Jira에 자동 배정한다.

**② OUTBOUND — 해결 감지 → ingest (파랑 #16이 핵심)**

`poll()`의 sync 단계가 티켓의 `resolved` 진입을 감지하면(미ingest일 때 1회) **`ingestResolved`(#16)** 가
`getIssueRaw`로 description·해결 코멘트를 가져오고, `summarizeResolution`(LLM)이 symptom/cause/
resolution을 채운 뒤, **#15 스키마**대로 `raw/jira`·`raw/ci`를 동결하고 `case-log`·`index`·`log`를
갱신한다. 축적된 case-log는 반복 사례를 known-failure로 승격시켜 **다음 분류의 신뢰도를 높인다(compounding).**

## PR별 기여 요약

| PR | 파일 | 하는 일 | 꽂히는 지점 |
|---|---|---|---|
| **#17** 🟧 | `server/jenkins.mjs`, `index.mjs normalize()` | 실티켓 파싱 + Jenkins 2단 로그 수집으로 분류 입력 보강 | poll() **신규 티켓** 단계 |
| **#16** 🟦 | `server/ingest.mjs`, `jira.mjs getIssueRaw`, `classifier.mjs summarizeResolution` | 해결 티켓을 vault로 동결·기록 (sink) | poll() **추적 sync**(resolved) 단계 |
| **#15** 🟩 | `wiki-vault/README.md`, `raw/{ci,gerrit}` | ingest가 쓰는 raw 3-소스 스키마·correlation key 정의 | vault 저장 구조 |

세 PR이 `poll()`의 서로 다른 단계에 꽂혀 하나의 파이프라인을 이룬다: #17이 채운 `event.log`가 곧
분류 입력이자, 해결 시 #16이 `raw/ci`(#15 스키마)로 동결하는 데이터다.
