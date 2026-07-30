# LLM-WIKI 스키마 (SVP wiki-vault)

Andrej Karpathy의 llm-wiki 컨셉([원문 전문](../docs/llm-wiki-concept.md))을 SVP에 맞게 구체화한 지식 베이스.
**1차 독자는 사람이 아니라 LLM이다.** 이 문서가 vault의 스키마다 — 구조, 구성 요소별 역할,
지켜야 할 규칙을 명세하며, classifier/ingest LLM에게 컨텍스트로 제공된다.

이 vault에는 **wiki를 구성하는 항목만** 둔다. 사람용 절차 문서(당번 가이드 등)는 `docs/`에 둔다.
이 폴더는 Obsidian vault로 바로 열 수 있다.

## 3계층 매핑

| 계층 | SVP 구현 | 수정 주체 |
|---|---|---|
| raw sources | Jira 이슈 · CI/CD 빌드 로그 · Gerrit 패치 (원본) + `raw/` (해결 확정 시점 원문 사본, 소스별) | 없음 — 불변, 읽기 전용 |
| wiki | `wiki-vault/` 마크다운 노트 | 서버(자동 파일 — `server/ingest.mjs`, case-log 내용은 LLM 작성) + 사람 (PR 리뷰) |
| schema | 이 문서 + CLAUDE.md의 LLM-WIKI 규칙 섹션 | 팀 (PR 리뷰) |

## 구조와 구성 요소별 역할

```
wiki-vault/
  README.md                스키마 (이 문서)
  index.md                 콘텐츠 카탈로그 — 서버가 재생성
  log.md                   시간순 작업 기록 — 서버(ingest)·앱(lint) append
  case-log.md              해결 사례 원장 — 서버가 append
  modules/<module>.md      모듈별 known-failure 지식 노트
  raw/jira/<티켓키>.md       Jira 티켓 원문 사본 — 서버 생성, 불변 (재해결은 <키>-r<n>.md)
  raw/ci/<티켓키>.md          CI 실패 로그 발췌 — 서버 생성, 불변 (파일 키는 P0a로 Jira 키, 재해결은 -r<n>)
  raw/gerrit/<Change-Id>.md   Gerrit 패치 원문(제목·파일·diff 발췌) — (미구현, 계획)
  raw/jira/.ingest-state.json     해결 이벤트 멱등성 상태 — 서버 자동 관리 (아래 "상태 파일")
  raw/jira/.signature-index.json  실패 서명 dedup 인덱스 — 서버 자동 관리
  .feedback.json           노트 피드백 집계 (👍/👎) — 서버 자동 관리
```

세 raw 소스는 **하나의 사건**을 서로 다른 각도에서 본 원자료다. Jira 키를 앵커로 삼아
frontmatter로 상호 링크한다 (아래 "raw correlation key"). ingest는 현재 jira·ci 둘을 함께
동결해 증거 사슬을 만든다. gerrit 동결은 미구현(계획)이다.

| 구성 요소 | 역할 | 쓰기 주체 |
|---|---|---|
| `modules/<module>.md` | **압축된 지식.** 반복 실패 패턴(known-failure)의 축적처이자 분류 신뢰도의 주 근거 | 사람 PR (ingest LLM 초안 PR은 미구현 — 계획) |
| `case-log.md` | **사례 원장.** 해결된 이슈를 건별로 보존하는 축적층. 반복 사례는 모듈 노트로 승격된다 | 서버 append (`server/ingest.mjs`) — symptom/cause/resolution은 LLM(summarizeResolution)이 raw를 읽어 작성 |
| `raw/jira/<티켓키>.md` | **원자료 사본.** 해결(Done) 확정 시점의 티켓 원문(설명·해결 코멘트)을 증거로 동결. Jira 보존 정책·티켓 삭제와 무관하게 역참조를 보장 | 서버(`server/ingest.mjs`)가 해결 확정 시 생성 — 이후 수정 금지(불변). reopen 후 재해결은 `<키>-r<n>.md`로 버전 추가 |
| `raw/ci/<티켓키>.md` | **실패 신호 원문.** 이슈를 유발한 CI 실패의 테스트 이름·로그 발췌. 티켓 설명보다 정확한 1차 증상. 파일 키는 빌드 ID 부재로 Jira 키를 쓴다 (P0a) | 서버가 해결 확정 시 생성 — 이후 수정 금지(불변). 재해결은 `-r<n>` 버전 |
| `raw/gerrit/<Change-Id>.md` | **해결 증거 원문.** 이슈를 고친 Gerrit 패치(제목·변경 파일·diff 발췌). `resolution`을 채우는 가장 강한 근거 — 코멘트 텍스트보다 실제 변경이 낫다 | (미구현 — 계획) 현재 생성하는 코드 없음. 구현 시 불변 원칙 동일 |
| `index.md` | **카탈로그.** 노트당 한 줄(링크 + 요약). 사람·Obsidian용 진입점 — LLM 드릴다운은 파일에서 직접 만든 카탈로그를 쓴다 | 서버(ingest)·앱(lint)이 재생성 — 수동 편집 금지 |
| `log.md` | **연대기.** ingest/lint 작업의 append-only 기록 | 서버(ingest)·앱(lint) append — 수동 편집 금지 |
| `README.md` | **스키마.** 구조·역할·규칙의 명세. query 대상 아님 | 팀 PR |

새 디렉터리·노트 타입은 이 스키마에 먼저 정의한 뒤 만든다.

현재 이 repo의 vault는 **데모 시드 상태**다: 모듈 노트 3개(`auth`/`payment`/`infra`,
owner `alice`/`bob`/`carol`)만 있고 case-log는 비어 있으며 `raw/`에는 `.gitkeep`뿐이다.

## Frontmatter (지식 노트 공통)

`modules/`의 모든 노트는 YAML frontmatter로 시작한다. 자동 파일(index/log/case-log)은 제외.

| 필드 | 값 | 규칙 |
|---|---|---|
| `type` | `module` | 노트 타입 (새 타입은 스키마에 먼저 정의) |
| `module` | CI 이벤트의 module 필드 값 | 파일명과 일치 |
| `owner` | `src/shared/team.ts`의 팀원 id | 담당자 라우팅 근거 |
| `tags` | 커버 영역 키워드 배열 | 검색 보조 (예: login, session) |
| `updated` | YYYY-MM-DD | **노트를 수정한 주체(사람·ingest LLM)가 갱신** |

- **사실의 단일 출처**: owner/scope는 frontmatter에만 쓴다. 본문에 중복하지 않는다.
- query는 frontmatter를 본문과 함께 텍스트로 검색하고, `tags`는 note-signal로 티켓
  제목·로그와 역방향 대조된다(+2). `module`/`owner`는 서버가 정확 파싱해 분류 카테고리
  enum과 담당자 매핑에 쓴다 (`server/wiki-query.mjs` `listModules`/`resolveOwner`).

## 형식 명세

### 모듈 노트 — `modules/<module>.md`

`<module>`은 CI 이벤트의 module 필드 값과 일치해야 한다 (예: `auth`, `payment`, `infra`).

```markdown
---
type: module
module: <module>
owner: <팀원 id>
tags: [<커버 영역 키워드>]
updated: <YYYY-MM-DD>
---

# <module> 모듈

## Known failures

### <실패 패턴 이름>

- symptom: <실패한 테스트 이름·에러 문자열 원문 포함>
- cause: <확인된 원인. 추정이면 "추정:"으로 명시>
- fix: <해결 절차. 실행 가능한 단계로>
- confidence-hint: <이 패턴 매칭 시 배정 힌트 — 선택 필드>
```

### case-log 항목

이슈 해결(resolved 전이) 시 서버(`server/ingest.mjs`)가 자동 append.
**메타데이터만 남기면 축적 효과가 없다** — symptom/cause/resolution은
LLM(`summarizeResolution`)이 raw 증거(티켓 설명·해결 코멘트·CI 로그)를 읽어 채운다
(LLM 자격증명이 없으면 fallback으로 symptom만 채워지고 cause/resolution은 불명).
형식은 3가지 변형이 있다.

**① 일반(full) 엔트리** — 신규 실패 서명이거나 dedup 시간창이 만료된 티켓:

```markdown
## <이벤트 ID> — <제목>

- date: <ISO 타임스탬프 — 기록 시점>
- module: <분류된 모듈>
- type: <이벤트 타입>
- confidence: <분류 신뢰도 0~100>
- assignee: <담당자> (feature-owner | sheriff)
- jira: <티켓 키> — 원문 사본은 raw/jira/<파일 키>.md
- ci-build: <티켓 키 — P0a: 빌드 ID 부재로 Jira 키 대체> — 원문 사본은 raw/ci/<파일 키>.md
- symptom: <실패 테스트 이름·에러 문자열 — LLM이 raw에서 추출>
- cause: <확인된 원인 — Jira 해결 코멘트 기반, 확인 안 되면 불명으로>
- resolution: <실제 해결 절차>
- wiki-refs: <분류에 참조된 노트 제목들 — 없으면 (없음)>
```

`gerrit` 필드는 아직 기록하지 않는다 (raw/gerrit 미구현).

**② 포인터 엔트리** — 같은 실패 서명의 중복 티켓(dedup). 풀 지식은 anchor 엔트리에
있고 여기엔 링크·카운트만 남는다 (LLM summarize도 스킵). 제목의 관계 표식은
재발이면 `재발(추정)`, 이미 dedup된 티켓의 재해결이면 `재해결`:

```markdown
## <이벤트 ID> — <제목> (재발(추정) → <anchor 티켓 키>, 누적 <N>건)

- date: <ISO 타임스탬프>
- module: <분류된 모듈>
- type: <이벤트 타입>
- jira: <티켓 키> — 원문 사본은 raw/jira/<파일 키>.md
- ci-build: <티켓 키> — 원문 사본은 raw/ci/<파일 키>.md
- ref: 해결 근거는 <anchor 티켓 키> 참조 (같은 실패 서명 — 병합은 당번이 Jira에서 확인)
```

**③ supersede 표식** — anchor 티켓 자신이 reopen 후 재해결된 경우. 일반 엔트리
형식에 제목 접미 ` (재해결 #<n>)`과 첫 필드로 supersede 주석이 붙는다:

```markdown
## <이벤트 ID> — <제목> (재해결 #<n>)

- note: reopen 후 재해결 (재기록 #<n>, 이전 기록 supersede)
- date: ...  (이하 일반 엔트리와 동일)
```

query는 case-log를 파일 통짜가 아니라 **엔트리 단위**로 소비한다
(`server/wiki-query.mjs` `caseLogEntries`): 포인터 엔트리(②)는 지식이 아니라
링크이므로 검색에서 제외하고, 같은 이벤트 ID의 full 엔트리가 여러 개면 최신(③의
교정본)만 남기며, `.signature-index.json`의 재발 count가 높은 엔트리는
가점(recurrenceBoost)을 받는다.

### raw correlation key

raw 소스는 **Jira 키를 앵커**로 상호 참조한다. ingest는 하나의 사건을 동결할 때
가능한 raw를 모두 만들고, 각 노트 frontmatter에 나머지 소스로의 링크를 넣는다.
링크가 있어야 LLM이 "티켓 → 실제 실패 로그 → 그걸 고친 패치"를 한 사슬로 따라간다.

| 소스 | 파일 키 | frontmatter로 참조하는 다른 소스 |
|---|---|---|
| Jira | `<티켓 키>` | `ci-build` (P0a: 값도 Jira 키) |
| CI/CD | `<티켓 키>` — CI 이벤트에 빌드 ID가 없어 Jira 키로 대체 (P0a) | `jira` |
| Gerrit | `<Change-Id>` (미구현 — 계획) | `jira`, `ci-build` |

- **키가 안 잡히는 경우**(예: 커밋 메시지에 Jira 키가 없어 Gerrit↔Jira를 못 잇는 경우)는
  링크를 억지로 채우지 않고 생략한다. 있는 링크만 신뢰한다.
- 소스별 raw는 **해결 이벤트당 1개** — reopen 후 재해결은 `<키>-r<n>`로 버전 추가한다(불변 원문 보존). 재시작·중복 폴링 등 중복은 `raw/jira/.ingest-state.json`의 resolvedAt로 막는다.

### raw 항목 — `raw/jira/<티켓키>.md`

ingest 시 case-log와 함께 생성되는 티켓 원문 사본. LLM이 요약·가공하지 않고 원문 그대로 담는다
(가공된 신호는 case-log의 몫).

```markdown
---
type: raw
source: jira
jira: <티켓 키>
ci-build: <티켓 키 — P0a: 빌드 ID 부재로 Jira 키 대체>
captured: <ISO 타임스탬프 — ingest 시점>
---

# <티켓 키> — <티켓 제목>

## Description
<티켓 설명 원문 — Jira 조회 실패 시 이벤트 로그로 대체, 없으면 (없음)>

## Resolution comments
<해결 코멘트 원문 — 없으면 (없음)>
```

`gerrit` frontmatter 필드는 raw/gerrit 구현 시 추가한다 (미구현).

### raw 항목 — `raw/ci/<티켓키>.md`

이슈를 유발한 CI 실패의 원문. 티켓 설명은 가공될 수 있으나 이 로그는 1차 증상이다.
요약 금지 — 실패 테스트 이름·에러 로그를 원문 그대로 담는다. 파일 키는 빌드 ID가
아니라 Jira 키다 (P0a — CI 이벤트에 빌드 ID가 없다).

```markdown
---
type: raw
source: ci
build: <티켓 키 — P0a: 빌드 ID 대체>
jira: <티켓 키>
module: <CI 이벤트의 module 필드>
captured: <ISO 타임스탬프 — ingest 시점>
---

# <티켓 키> — <이벤트 타입>

## Failed tests
<이벤트 제목 — 실패 테스트 이름 포함>

## Log excerpt
<이벤트 로그 원문 — Jenkins 빌드 consoleText 꼬리 포함, 없으면 (없음)>
```

### raw 항목 — `raw/gerrit/<Change-Id>.md` (미구현 — 계획)

**현재 이 파일을 생성하는 코드는 없다** (`raw/gerrit/`에는 `.gitkeep`뿐).
아래는 Gerrit 소스 어댑터 구현 시 따를 스키마다.

이슈를 고친 Gerrit 패치. `case-log`의 `resolution`을 채우는 가장 강한 증거 —
코멘트로 "고쳤다"는 말보다 실제 변경 파일·diff가 근거로 낫다. diff는 발췌(핵심 hunk)로 담되
원문 그대로 두고, 요약은 case-log의 몫으로 남긴다.

```markdown
---
type: raw
source: gerrit
change-id: <Change-Id>
jira: <연결된 티켓 키 — 커밋 메시지 footer 기반, 없으면 생략>
ci-build: <이 패치에서 실패했던 빌드 ID — 없으면 생략>
captured: <ISO 날짜 — Done 확정 시점>
---

# <Change-Id> — <패치 제목>

## Changed files
<파일 목록 + 파일별 +추가/-삭제 라인 수>

## Diff excerpt
<핵심 hunk 원문 발췌>
```

### 상태 파일 (서버 자동 관리 — 편집 금지)

query·index 대상이 아닌 숨김 JSON — vault 순회 코드가 `.` 시작 파일·폴더를 제외한다.

- `raw/jira/.ingest-state.json` — 해결 이벤트 멱등성 상태:
  `{ "<티켓 키>": { "at": "<resolvedAt ISO>", "n": <재기록 횟수> } }`.
  재시작·중복 폴링(같은 resolvedAt)은 스킵하고, reopen 후 더 늦은 resolvedAt만 재기록(n+1).
- `raw/jira/.signature-index.json` — 실패 서명 dedup 인덱스:
  `{ "<서명>": { "anchorKey", "module", "count", "tickets": [...], "lastAt" } }`.
  서명은 로그의 `TC name or file: <값>` 우선, 없으면 제목 정규화(접두 `[..]`·접미 Failed 제거,
  소문자). 같은 모듈 + 시간창(`SVP_DEDUP_WINDOW_DAYS`, 기본 14일) 내에서만 재발로 묶는다.
- `<vault>/.feedback.json` — 노트 피드백 집계: `{ "<노트 제목>": { "up": <n>, "down": <n> } }`.
  서버가 `wiki:feedback` 소켓 이벤트를 받아 누적하며 query 감점의 근거다 (아래 feedback).

### index.md / log.md

- `index.md` — 노트당 한 줄 카탈로그. 서버가 ingest 시 재생성한다. LLM 드릴다운(SVP-3)은
  index.md 대신 파일에서 직접 만든 카탈로그를 쓰므로, index는 사람·Obsidian용 진입점이다.
- `log.md` — `## [YYYY-MM-DD] op | detail` 형식 append-only (op: ingest | lint). `grep "^## \[" log.md`로 파싱.

## wiki 4대 동작

1. **query** — 이슈 유입 시 classifier가 vault를 검색해 상위 노트를 신뢰도 근거로 사용.
   신뢰도 >80 → feature owner, ≤80 → sheriff 배정의 근거가 된다. 두 경로의 합집합을 classify에 넘긴다:
   - **키워드 스코어링** (`server/wiki-query.mjs` `queryWiki`) — 양방향 대조.
     이벤트→노트: 이벤트 키워드(module +3, 제목의 4자 이상 단어 +1)가 노트에 있는지.
     노트→이벤트: 노트의 frontmatter tags·known-failure 원문 신호(`###` 제목·symptom 줄의
     5자 이상 식별자)가 티켓 텍스트(제목 + Jenkins 실패 로그)에 있으면 신호당 +2 —
     로그가 제목보다 실측 신호가 많아 원문이 로그에 찍힌 노트가 위로 온다. 상위 3개(score>0)만.
   - **LLM 드릴다운(SVP-3)** — classify 이전에 별도 LLM 호출이 로그를 읽고 원인을 가설화한 뒤
     `index.md` 대신 파일/제목/module/tags만 담은 카탈로그에서 관련 노트를 최대 3개 고른다
     (`server/classifier.mjs` `selectNotes`). 카탈로그에 없는 경로는 버리고, 실패·무자격 시 빈 결과로
     키워드 매칭에만 의존 — 자동 배정 게이트(신뢰도 규칙)에는 영향을 주지 않는다.
   - **retrieval 자기교정 3종** (단위테스트: `server/wiki-query.test.mjs`) —
     ① supersede: case-log는 엔트리 단위로 검색하며 포인터 엔트리 제외, 같은 이벤트 ID는
     최신 교정본만 (`caseLogEntries`). ② recurrence: `.signature-index.json`의 재발 count가
     높은 case-log 엔트리에 가점 `min(count-1, SVP_RECUR_BOOST_CAP)` (기본 상한 4).
     ③ feedback demotion: 아래 feedback 항목.
2. **feedback** — 담당자가 참조 노트에 👍/👎. 앱이 `wiki:feedback` 소켓으로 서버에 전달하고,
   서버가 `<vault>/.feedback.json`에 집계한다 (`server/wiki-query.mjs` `recordFeedback` — 구현됨).
   👎가 `SVP_FEEDBACK_DEMOTE`회(기본 3) 이상이면서 👎>👍인 노트는 query 점수 반감
   (`feedbackDemotion`). 앱도 로컬 사본(userData)에 같은 집계를 유지하지만 이는 당번 위키
   점검(lint)용 — 서버 집계와 동기화되지 않는 별도 사본이라는 한계가 있다.
3. **ingest — append가 아니라 통합이다.** 이슈 해결(resolved 전이) 시 서버(`server/ingest.mjs`)가
   수행한다 (`SVP_INGEST_MODE=live`일 때만 실제 기록, 기본 dry-run):
   - 구현됨: raw 동결(`raw/jira/` + `raw/ci/`, 티켓마다 — 재발이어도 raw는 보존),
     case-log append(LLM이 symptom/cause/resolution 작성), index.md 재생성 + log.md append,
     실패 서명 dedup 4모드(full / anchor-reresolve / member-reresolve / recurrence —
     포인터·supersede 형식은 위 "case-log 항목" 참조).
   - (미구현) raw/gerrit 동결. known-failure 갱신 초안 PR 제출 — 새 패턴 →
     `modules/<module>.md` 갱신 초안, 기존 패턴과 모순(기록된 fix가 더 이상 안 통함 등) →
     모순을 명시하는 수정 초안.
   - **known-failure 승격을 사람 수작업에만 맡기지 않는다** (미구현 — 계획). LLM이 초안을 쓰고
     사람은 리뷰한다 — 이 통합 단계가 없으면 wiki는 축적되지 않는다 (카파시 컨셉의 핵심).
4. **lint** — 당번이 앱에서 실행하는 위생 점검 (`src/main/modules/wiki/`). 두 단계:
   - 기계 점검 (현재 구현, 클라이언트): 고아 노트(어디서도 참조 안 됨), 👎 누적 노트 —
     단, 앱 로컬 피드백 사본 기준이라 서버 집계(`.feedback.json`)와 다를 수 있다.
   - LLM 점검 (미구현 — F8): 노트 간 모순, case-log와 어긋나는 낡은 fix 절차, case-log에 반복되는데
     known-failure로 승격 안 된 패턴, 이슈는 오는데 노트가 없는 모듈. 정리·보완 후보로 보고.

feedback→lint가 "쓸데없는 정보가 wiki를 오염시키지 않게 하는 루프"다.
좋은 노트는 살아남고, 안 쓰이는 노트는 감점→정리된다.

## 지켜야 할 규칙

- **vault에는 wiki 구성 요소만 둔다.** 사람용 절차·가이드 문서는 `docs/`로.
- 자동 파일(index/log/case-log/raw)은 사람이 편집하지 않는다. 그 외 모든 노트 변경은 코드와 동일하게 PR 리뷰를 거친다.
- **`raw/`는 서버의 query·index 대상이 아니다** — 증거 보존과 드릴다운(분류 근거 검증) 용도.
  (한계: 앱의 lint/index 재생성은 `raw/` 제외가 없어, raw가 쌓인 vault를 앱에서 점검하면 raw가 함께 잡힌다.)
  압축된 검색 신호는 case-log와 모듈 노트가 담당한다 (서버 query·index 코드가 `raw/`와
  `.` 시작 파일·폴더를 제외한다).
- 운영 vault의 raw에는 사내 티켓·CI 로그·Gerrit 소스 diff 원문이 그대로 담긴다 —
  내부 호스트명·경로·소스코드가 노출되므로, 운영 vault는 사내 저장소에만 두고
  이 repo에는 시드·데모 외 절대 push하지 않는다 (ARCHITECTURE.md vault 저장소 경계).
  raw 동결 시 명백한 비밀 패턴(토큰·키·내부 URL)은 최소 마스킹한다.
- 노트 하나 = 주제 하나. 파일명은 kebab-case.
- 애매한 표현 금지. 명시적 사실 / 재현 조건 / 담당자 / 해결 절차만 쓴다.
  - 나쁨: "가끔 인증 쪽이 불안정함" / 좋음: "LoginFlowTest.test_token_refresh가 간헐적으로 401 반환"
- **실패한 테스트 이름과 에러 문자열은 원문 그대로 포함한다.** query가 노트의 symptom·`###`
  제목에서 뽑은 식별자 신호를 티켓 제목·Jenkins 로그와 대조(+2)하므로, 원문이 없으면 노트가
  검색되지 않는다.
- cause에는 확인된 사실만. 추정이면 "추정:"을 붙인다 — LLM이 추정을 사실로 전파하지 않게.
- 노트끼리는 마크다운 링크로 연결한다. 링크 없는 노트는 lint에서 고아로 잡힌다.
- 해결된 이슈에서 새 패턴을 발견하면 case-log에만 두지 말고 `modules/<module>.md`의
  known-failure로 승격한다. case-log는 사례 원장, 모듈 노트가 압축된 지식이다.
  현재는 담당자가 직접 PR한다 (ingest의 LLM 초안 생성은 미구현 — 계획).
