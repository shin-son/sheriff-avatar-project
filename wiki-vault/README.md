# LLM-WIKI 스키마 (SVP wiki-vault)

Andrej Karpathy의 llm-wiki 컨셉([원문 전문](../docs/llm-wiki-concept.md))을 SVP에 맞게 구체화한 지식 베이스.
**1차 독자는 사람이 아니라 LLM이다.** 이 문서가 vault의 스키마다 — 구조, 구성 요소별 역할,
지켜야 할 규칙을 명세하며, classifier/ingest LLM에게 컨텍스트로 제공된다.

이 vault에는 **wiki를 구성하는 항목만** 둔다. 사람용 절차 문서(당번 가이드 등)는 `docs/`에 둔다.
이 폴더는 Obsidian vault로 바로 열 수 있다.

## 3계층 매핑

| 계층 | SVP 구현 | 수정 주체 |
|---|---|---|
| raw sources | CI 로그, Jira 이슈 이벤트 (원본) + `raw/` (해결 확정 시점 원문 사본) | 없음 — 불변, 읽기 전용 |
| wiki | `wiki-vault/` 마크다운 노트 | 앱(자동 파일) + LLM 초안 + 사람 (PR 리뷰) |
| schema | 이 문서 + CLAUDE.md의 LLM-WIKI 규칙 섹션 | 팀 (PR 리뷰) |

## 구조와 구성 요소별 역할

```
wiki-vault/
  README.md                스키마 (이 문서)
  index.md                 콘텐츠 카탈로그 — 자동 생성
  log.md                   시간순 작업 기록 — 자동 append
  case-log.md              해결 사례 원장 — 자동 append
  modules/<module>.md      모듈별 known-failure 지식 노트
  raw/jira/<티켓키>.md      Jira 티켓 원문 사본 — 자동 생성, 불변
```

| 구성 요소 | 역할 | 쓰기 주체 |
|---|---|---|
| `modules/<module>.md` | **압축된 지식.** 반복 실패 패턴(known-failure)의 축적처이자 분류 신뢰도의 주 근거 | 사람 PR + ingest LLM 초안 PR (F7) |
| `case-log.md` | **사례 원장.** 해결된 이슈를 건별로 보존하는 축적층. 반복 사례는 모듈 노트로 승격된다 | 앱 append (F7부터 LLM이 내용 작성) |
| `raw/jira/<티켓키>.md` | **원자료 사본.** 해결(Done) 확정 시점의 티켓 원문(설명·해결 코멘트·로그 발췌)을 증거로 동결. Jira 보존 정책·티켓 삭제와 무관하게 역참조를 보장 | 앱이 Done 확정 시 1회 생성 (F7) — 이후 수정 금지 |
| `index.md` | **카탈로그.** query의 진입점 — 노트당 한 줄(링크 + 요약) | 앱이 재생성 — 수동 편집 금지 |
| `log.md` | **연대기.** ingest/lint 작업의 append-only 기록 | 앱 append — 수동 편집 금지 |
| `README.md` | **스키마.** 구조·역할·규칙의 명세. query 대상 아님 | 팀 PR |

새 디렉터리·노트 타입은 이 스키마에 먼저 정의한 뒤 만든다.

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
- 현재 query는 frontmatter도 본문과 함께 텍스트로 검색한다. F2(query 개선)에서
  `module`/`owner` 정확 매칭과 Obsidian Dataview 활용의 기반이 된다.

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

이슈 해결 시 앱이 자동 기록. **메타데이터만 남기면 축적 효과가 없다** —
다음 분류가 재사용할 수 있도록 증상·원인·해결 내용을 원문으로 보존한다.

```markdown
## <이벤트 ID> — <제목>

- date: <ISO 날짜>
- module: <분류된 모듈>
- type: <이벤트 타입>
- confidence: <분류 신뢰도 0~100>
- assignee: <담당자> (feature-owner | sheriff)
- jira: <티켓 키 — 원문 사본은 raw/jira/<티켓키>.md>
- symptom: <실패 테스트 이름·에러 문자열 원문>
- cause: <확인된 원인, Jira 해결 코멘트 기반>
- resolution: <실제 해결 절차>
- wiki-refs: <분류에 참조된 노트와 도움 여부>
```

현재 코드는 date~assignee까지만 기록하고 resolution은 고정 문구다. jira 이하 필드는
F7(해결 감지→ingest)에서 LLM이 Jira 해결 코멘트를 읽어 채운다.

### raw 항목 — `raw/jira/<티켓키>.md`

ingest 시 case-log와 함께 생성되는 티켓 원문 사본. LLM이 요약·가공하지 않고 원문 그대로 담는다
(가공된 신호는 case-log의 몫). 티켓당 1개 — ingest 1회 규칙과 동일한 키로 중복을 막는다.

```markdown
---
type: raw
jira: <티켓 키>
captured: <ISO 날짜 — Done 확정 시점>
---

# <티켓 키> — <티켓 제목>

## Description
<티켓 설명 원문>

## Resolution comments
<해결 코멘트 원문>

## Log excerpt
<CI 로그 발췌>
```

### index.md / log.md

- `index.md` — 노트당 한 줄 카탈로그. query 시 LLM이 가장 먼저 읽는다.
- `log.md` — `## [YYYY-MM-DD] op | detail` 형식 append-only (op: ingest | lint). `grep "^## \[" log.md`로 파싱.

## wiki 4대 동작

1. **query** — 이슈 유입 시 classifier가 vault를 검색해 상위 3개 노트를 신뢰도 근거로 사용.
   신뢰도 >80 → feature owner, ≤80 → sheriff 배정의 근거가 된다.
   (현재: 전체 파일 키워드 매칭. 목표: index를 먼저 읽고 노트로 드릴다운 — TODO(SVP-3))
2. **feedback** — 담당자가 참조 노트에 👍/👎. 👎3회 이상(또한 👎>👍)이면 query 점수 절반 감점.
   집계는 vault가 아니라 앱 저장소에 쌓인다 (vault는 패키징 시 읽기 전용. F8: hub 경유 서버 집계).
3. **ingest — append가 아니라 통합이다.** 이슈 해결 시:
   - case-log에 항목 기록 + log/index 갱신 (현재 구현).
   - F7: 티켓 원문을 `raw/jira/<티켓키>.md`로 동결하고,
     LLM이 Jira 해결 코멘트를 읽어 symptom/cause/resolution을 채우고, 기존 known-failure와 대조한다.
     - 새 패턴 → `modules/<module>.md` known-failure 갱신 초안을 만들어 PR로 제출.
     - 기존 패턴과 모순(기록된 fix가 더 이상 안 통함 등) → 해당 노트에 모순을 명시하는 수정 초안.
   - **known-failure 승격을 사람 수작업에만 맡기지 않는다.** LLM이 초안을 쓰고 사람은 리뷰한다 —
     이 통합 단계가 없으면 wiki는 축적되지 않는다 (카파시 컨셉의 핵심).
4. **lint** — 주기 실행되는 위생 점검. 두 단계:
   - 기계 점검 (현재 구현): 고아 노트(어디서도 참조 안 됨), 👎 누적 노트.
   - LLM 점검 (F8): 노트 간 모순, case-log와 어긋나는 낡은 fix 절차, case-log에 반복되는데
     known-failure로 승격 안 된 패턴, 이슈는 오는데 노트가 없는 모듈. 정리·보완 후보로 보고.

feedback→lint가 "쓸데없는 정보가 wiki를 오염시키지 않게 하는 루프"다.
좋은 노트는 살아남고, 안 쓰이는 노트는 감점→정리된다.

## 지켜야 할 규칙

- **vault에는 wiki 구성 요소만 둔다.** 사람용 절차·가이드 문서는 `docs/`로.
- 자동 파일(index/log/case-log/raw)은 사람이 편집하지 않는다. 그 외 모든 노트 변경은 코드와 동일하게 PR 리뷰를 거친다.
- **`raw/`는 query·index·lint 대상이 아니다** — 증거 보존과 드릴다운(분류 근거 검증) 용도.
  압축된 검색 신호는 case-log와 모듈 노트가 담당한다. (F7에서 wiki 코드에 제외 처리 반영)
- 운영 vault의 raw에는 사내 티켓·로그 원문이 그대로 담긴다 — 운영 vault는 사내 저장소에만 두고
  이 repo에는 시드·데모 외 절대 push하지 않는다 (ARCHITECTURE.md vault 저장소 경계).
- 노트 하나 = 주제 하나. 파일명은 kebab-case.
- 애매한 표현 금지. 명시적 사실 / 재현 조건 / 담당자 / 해결 절차만 쓴다.
  - 나쁨: "가끔 인증 쪽이 불안정함" / 좋음: "LoginFlowTest.test_token_refresh가 간헐적으로 401 반환"
- **실패한 테스트 이름과 에러 문자열은 원문 그대로 포함한다.** 현재 query는 이벤트의 module명과
  제목 키워드(4자 이상 단어) 매칭으로 동작하므로, 원문이 없으면 노트가 검색되지 않는다.
- cause에는 확인된 사실만. 추정이면 "추정:"을 붙인다 — LLM이 추정을 사실로 전파하지 않게.
- 노트끼리는 마크다운 링크로 연결한다. 링크 없는 노트는 lint에서 고아로 잡힌다.
- 해결된 이슈에서 새 패턴을 발견하면 case-log에만 두지 말고 `modules/<module>.md`의
  known-failure로 승격한다. case-log는 사례 원장, 모듈 노트가 압축된 지식이다.
  F7 전까지는 담당자가 직접 PR, F7 이후에는 LLM 초안을 리뷰만 하면 된다.
