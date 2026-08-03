# SVP 데모 영상 시나리오 (3~5분 · PC 1대)

> **v3 기준 갱신 (2026-07-30)**: 서버는 앱과 분리된 별도 프로세스(`npm run server`)이고, 역할은
> 로그인이 결정하며(admin/admin=당번, 아이디=비밀번호=팀원), 분류는 Claude(Bedrock)가 실제로 수행한다.
> **장면 3~4의 compounding(해결 → case-log 기록 → 재발 시 근거 소환·재발 감지)** 은 서버측 ingest(F7)로
> 구현돼 있다. 단, ingest는 기본 dry-run이라 **`SVP_INGEST_MODE=live`를 켜야** case-log가 실제로 기록된다(아래 체크리스트).

> 목표: **"CI 실패 → Jira 티켓 → LLM이 WIKI를 읽고 담당자 매칭 → Jira에서 해결 → WIKI가 실시간으로 배운다"**
> 를 3~5분 영상 한 편으로 보여준다. 핵심 컷은 두 개 —
> ① **Jira에서 티켓을 Done 처리하면 앱이 알아서 감지·기록하는 순간** (사람은 Jira만 쓰면 된다),
> ② **같은 이슈가 재발하자 방금 쌓인 해결 기록이 근거로 소환되고, 재발이 감지·집계되는 순간** (compounding).
>
> 라이브 시연이 아니라 **녹화 영상**이다. 장면별로 끊어 찍고 이어 붙여도 된다 — 단, compounding은 실제 연속 동작이어야 설득력이 있으므로 장면 3~4는 한 테이크로 찍는다.

## 촬영 구성 — PC 1대, 창 4개

모니터 하나(1920×1080 이상)를 4분할로 배치하고 전체 화면을 녹화한다(OBS 등).
역할 3인(당번/팀원 2명) 대신 **당번(admin 로그인) + 팀원(alice 로그인) 앱 2개**로 압축한다.
bob은 내레이션으로만 언급. 서버(`npm run server`)와 mock Jira는 백그라운드 터미널 — 화면에 안 잡는다.

```
┌──────────────────────────┬──────────────────────────┐
│ ① Sheriff 대시보드        │ ② Obsidian               │
│    (admin/admin 로그인)   │    wiki-vault/case-log.md │
│                          │    열어둔 상태              │
├──────────────────────────┼──────────────────────────┤
│ ③ 팀원 컴팩트 창          │ ④ mock Jira 티켓 뷰       │
│    (alice/alice 로그인)   │    (브라우저 또는 터미널)   │
└──────────────────────────┴──────────────────────────┘
```

- 팝업(toast)은 우하단에 뜨므로 ④ 위에 겹치며 등장한다 — 시선 유도에 오히려 유리. 리허설로 겹침 확인.
- 진행자 조작은 두 곳뿐: **④ Jira 브라우저 뷰**(티켓·댓글·상태 확인)와 **별도 터미널**
  (`POST /demo/trigger`로 CI 실패 재현, `POST /demo/resolve`로 해결 코멘트+Done 전이 — [API.md §5](./API.md)).
  mock Jira의 browse 뷰는 읽기 전용이라 코멘트·전이 조작은 터미널이 담당한다.

## 사전 준비 체크리스트

- [ ] `git restore wiki-vault && git clean -fd wiki-vault` — 이전 테스트로 오염된 case-log/index/log와
      untracked 상태 파일(raw 사본, `.ingest-state.json`, `.signature-index.json`, `.feedback.json`) 초기화
- [ ] `server/issue-cache.json` 삭제 — mock Jira는 재기동 시 티켓 키(CIOPS-1001~)를 재사용하므로,
      이전 세션 캐시가 남으면 새 티켓이 "복원"으로 오인돼 LLM 분류가 다시 돌지 않는다
- [ ] mock Jira 기동(8792) → `npm run server`(8793) → 앱 2개 로그인(admin/admin, alice/alice), 연결 초록불 확인.
      mock Jira는 시드 티켓 3건(auth-token-401·payment-build·snapshot-diff)을 깔고 시작한다 — 인트로의
      "이미 쌓여 있는 티켓" 배경으로 활용 (장면 3~4의 재발 판정과는 무관 — dedup은 **해결된** 티켓 기준)
- [ ] `.env`: **`SVP_JIRA_WRITE_MODE=live`** (데모는 실제 배정·댓글·전이를 보여줘야 함 — 기본 dry-run이면 아무것도 안 바뀜)
- [ ] `.env`: **`SVP_INGEST_MODE=live`** (장면 3~4 case-log 실시간 기록 컷 — 기본 dry-run이면 vault가 안 바뀌어 컷이 나오지 않음)
- [ ] 폴링 주기 확인 — 서버 기본 5초(`SVP_SERVER_POLL_MS`)면 데모에 충분
- [ ] Obsidian으로 `wiki-vault/` 열고 `case-log.md`를 화면에 띄워두기. 외부 파일 변경이 즉시 반영되는지 확인
- [ ] LLM env 유효 확인 — `AWS_REGION`(+SSO 로그인) 또는 `SVP_ANTHROPIC_API_KEY`. 시작 로그 `classifier: on` (off면 신뢰도가 전부 placeholder)
- [ ] Windows 집중 지원 켜서 다른 앱 알림 차단
- [ ] (선택) 투명/blur 배경에 바탕화면이 비쳐 지저분하면 앱을 `SVP_GLASS=solid`로 실행 — 불투명 배경 강제
- [ ] 타임라인대로 1회 전체 리허설 — 특히 장면 3~4 연속 테이크

## 타임라인 스토리보드 (총 ~4분 30초)

### 0:00–0:25 · 인트로

| 화면 포커스 | 액션 / 내레이션 |
|---|---|
| 4분할 전체 | (내레이션) "CI가 실패하면 Jira에 티켓이 쌓입니다. 누가 볼지 정하는 건 매번 사람이었습니다. Sheriff Avatar는 LLM이 팀 위키를 읽고 담당자를 찾아주는 데스크톱 에이전트입니다." 각 창을 커서로 짚으며 한 줄씩: 당번 대시보드 / 팀원 앱 / Jira / 팀 위키(Obsidian) |

### 0:25–1:15 · 장면 1 — 아는 이슈는 자동 배정

> 트리거: `POST /demo/trigger { "scenario": "auth-token-401" }` — `wiki-vault/modules/auth.md`에 known-failure로 존재하는 유형

| 화면 포커스 | 관객이 봐야 할 것 |
|---|---|
| ① 대시보드 | 이슈 행 등장 — known-failure 근거가 잡혀 신뢰도가 **대체로 80을 넘겨 황동 별**(LLM 비결정성으로 낮게 나오면 그 컷만 재촬영), 근거로 `modules/auth.md` 표시 (행을 펼쳐 판단 근거를 잠깐 보여줌) |
| ④ Jira | 티켓에 **요약 댓글**이 자동으로 달리고 assignee = alice 지정됨. "로그를 안 열어도 댓글만으로 상황 파악" 강조 |
| ③ alice 창 + 팝업 | 우하단 팝업 수신 → 클릭 → 컴팩트 창의 해당 이슈로 포커스 |

**내레이션**: "위키에 과거 사례가 있어서, 사람 개입 없이 담당자까지 갔습니다. 80점이 넘으면 자동 배정입니다."

### 1:15–2:10 · 장면 2 — Jira에서 해결하면, 앱이 알아서 기록한다 ★ 핵심 컷 ①

> alice가 이슈를 고쳤다고 가정하고, **Jira에서** 해결 코멘트를 달고 티켓을 Done으로 전이한다. 앱은 건드리지 않는다.
> mock에서는 터미널 한 방이 코멘트+Done 전이를 대신한다:
> `POST /demo/resolve { "key": "<장면 1 티켓키>", "comment": "테스트 fixture의 token TTL을 60s로 수정" }`
> — 이 코멘트가 LLM 해결 요약(case-log의 cause/resolution)의 원료가 되므로 내용을 성의 있게 쓴다.

| 화면 포커스 | 관객이 봐야 할 것 |
|---|---|
| ④ Jira | browse 뷰 새로고침 — 해결 코멘트가 달리고 상태 **Done** |
| ① 대시보드 | (폴링 감지, 수 초 내) 이슈가 자동으로 **해결됨** 처리 — 취소선, 목록 하단으로 이동 |
| ② Obsidian | **case-log.md에 새 항목이 실시간으로 나타남** — LLM이 Jira 해결 코멘트를 근거로 작성한 기록. 여기서 줌 인 |

**내레이션**: "담당자는 늘 하던 대로 Jira에서 끝냈을 뿐입니다. 앱이 이를 감지해서, LLM이 해결 내용을 팀 위키에 기록합니다. 이 기록이 다음 분류의 근거가 됩니다."

### 2:10–3:00 · 장면 3 — 모르는 이슈는 사람에게 (human-in-the-loop)

> 트리거: `POST /demo/trigger { "scenario": "snapshot-diff" }` — WIKI에 근거가 없는 처음 보는 유형
> ⚠️ 장면 3~4는 한 테이크로 촬영 (compounding의 연속성)

| 화면 포커스 | 관객이 봐야 할 것 |
|---|---|
| ① 대시보드 | **빈 별(≤80)** + "당번 확인 필요" — 미확인 황동 점이 붙은 채 당번 큐 최상단에 |
| ④ Jira | 댓글에도 "당번 확인 필요" — 자동화가 **아는 척하지 않는다** |
| ① 대시보드 | 당번이 내용 확인 → **수동 재배정**으로 alice 지정 |
| (터미널) | `/demo/resolve`로 해결 코멘트("스냅샷 기준 이미지를 갱신해 해결") + Done 전이 — **화면 컷은 생략해도 되지만 이 조작 자체는 필수** (ingest가 장면 4의 전제) |
| ② Obsidian | case-log에 이 사례도 기록됨 — **다음 장면의 복선**, 커서로 항목을 짚어둔다 |

**내레이션**: "모르는 건 사람에게 넘깁니다. 80점 임계값이 자동화와 사람 판단의 경계선입니다. 방금 이 해결 기록이 위키에 남았죠 — 기억해 두세요."

### 3:00–3:50 · 장면 4 — 같은 이슈가 다시 오면 ★ 핵심 컷 ② (compounding)

> 트리거: 장면 3과 **같은 시나리오** 재발 — `POST /demo/trigger { "scenario": "snapshot-diff" }`.
> 같은 TC명(`python.ui-snapshot-diff-041.py`)이 같은 실패 서명이 된다 — 별도 "-2" 시나리오는 없다.

| 화면 포커스 | 관객이 봐야 할 것 |
|---|---|
| ① 대시보드 | 같은 유형의 새 티켓 — 이번엔 행을 펼치면 근거에 **방금 쌓인 case-log 항목**(`case-log.md#<장면 3 티켓키>`)이 잡히고, summary가 이전 해결 기록(원인·해결책·담당자 alice)을 인용하며 신뢰도가 처음(근거 없음)보다 오른다 |
| ① 대시보드 | 당번이 근거의 case-log만 보고 **즉시 alice 재배정** — 10분 전엔 로그를 읽어야 했던 판단이 이번엔 한 클릭 |
| ③ alice 창 | 재배정 팝업 수신 |
| (터미널)+② | `/demo/resolve`로 Done 처리 → **case-log에 "재발(추정) → <장면 3 티켓키> (누적 2건)" 포인터**가 실시간 기록 — 시스템이 재발을 감지해 지식을 anchor 하나로 묶는다. Obsidian 줌 인 |

**내레이션**: "같은 이슈가 다시 오자, 시스템이 10분 전의 해결 기록을 근거로 가져왔습니다. 그리고 해결되는 순간 재발임을 감지해 기록을 하나로 묶습니다 — 재발 횟수는 다음 분류에서 검색 가중치가 됩니다. **쓸수록 판단 근거가 쌓입니다 — 이게 이 도구의 존재 이유입니다.**"

> **왜 이 장면에서 황동 별(자동 배정)이 아닌가**: snapshot-diff의 모듈(renderer-core)은 vault에
> `owner:`가 있는 모듈 노트가 없다. 분류 카테고리 enum 자체가 모듈 노트 목록에서 나오므로
> (`server/wiki-query.mjs` listModules → `server/classifier.mjs`), 노트가 없는 모듈은 `unknown`으로
> 남고 자동 배정 대상이 아니다. case-log 축적 → 당번의 모듈 노트 승격 → 자동 배정이 설계된 루프다.
>
> **(확장 컷, 선택)** 시간이 되면 장면 4 말미에 당번이 case-log를 근거로 `modules/renderer-core.md`
> (owner: alice, symptom에 TC명 원문)를 승격해 두고 세 번째 트리거를 쏘면 **황동 별 >80 자동 배정**까지
> 이어진다 — 서버는 vault를 분류 때마다 다시 읽으므로 재시작 없이 바로 반영된다.

### 3:50–4:30 · 마무리

| 화면 포커스 | 액션 / 내레이션 |
|---|---|
| 루프 다이어그램 (README의 mermaid 캡처 또는 슬라이드 1장) | "유입(Jira) → 분류(LLM+WIKI) → 배정(80점 라우팅) → Jira에서 해결 → 자동 기록(ingest) → 다음 분류가 더 정확해진다." 남은 일 한 줄: 사내 dry-run 검증은 완료 — live 쓰기 전환·분류 정확도 튜닝·EXE 배포 ([PLAN.md](./PLAN.md) Week 3) |

## 구현 전제 (전부 v3에 구현돼 있음 — 촬영 전 동작만 확인)

1. **Jira Done 폴링 감지 → 자동 resolve 처리 + LLM ingest** — 장면 2의 핵심. 앱의 "해결 완료" 버튼이 아니라 Jira 상태 전이가 트리거다 (`server/index.mjs` sync 루프 → `ingestResolved`).
2. mock Jira의 **상태 전이 조작 수단** — `POST /demo/resolve { key, comment }` ([API.md §5](./API.md)).
3. 폴링 간격 — `SVP_SERVER_POLL_MS` 기본 5초면 데모에 충분.

## 리허설에서 자주 터지는 것

- **장면 4 근거에 case-log 항목이 안 잡힌다** → 장면 3의 `/demo/resolve`·ingest가 누락됐거나 `SVP_INGEST_MODE=live`를 빼먹음. Obsidian에 case-log 항목이 실제로 보이는 걸 확인하고 넘어갈 것.
- **장면 4 Done 처리에서 포인터("재발(추정) → …")가 아니라 새 풀 엔트리가 기록된다** → 두 티켓의 분류 module이 서로 달랐던 것 (dedup 조건: 같은 실패 서명 + 같은 모듈 + 14일 창, `SVP_DEDUP_WINDOW_DAYS`). 데모 흐름에는 지장 없음 — 그 컷만 재촬영.
- **Jira Done 후 앱이 한참 조용하다** → 서버(`npm run server`)가 죽었거나 폴링 주기(`SVP_SERVER_POLL_MS`) 오설정.
- **팝업이 즉시 사라진다** → TTL 9초. 트리거 직후 말을 멈추고 커서로 팝업을 가리킬 것. (녹화이므로 최악의 경우 그 컷만 재촬영)
- **Obsidian이 갱신을 안 보여준다** → 해당 파일이 편집 모드로 포커스돼 있으면 반영이 늦을 수 있음. 읽기 모드로 열어둘 것.
- **데모 후 `git status`에 wiki-vault 변경이 남는다** → 커밋 금지, `git restore wiki-vault && git clean -fd wiki-vault` (README 병합 체크리스트와 동일 규칙).
