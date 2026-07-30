# 사내 전용 자산 템플릿 (INTERNAL-ASSETS)

> 이 문서는 **사내 전용 자산의 자리표시자 템플릿**이다. 사외 repo에는 실값을 커밋하지 않는다
> (CLAUDE.md 절대 규칙 4). 사내 clone에서 `<채우기>` 칸을 채워 팀 내부에서만 관리하고,
> **채운 버전은 절대 이 repo로 push하지 않는다** (절대 규칙 2 — 사내에서는 pull만).
>
> 아래 자산은 전부 **없어도 동작한다** — 각 섹션의 "없을 때 폴백"이 코드에 구현된 실제 강등 경로다.

## 1. `.tool/Jenkins/fetch_ci_test.py` — 1차 CI 로그 수집

서버 poll 루프가 신규 티켓의 Jenkins 빌드 링크에서 실패 로그를 확보할 때 가장 먼저 실행하는
사내 스크립트 (`server/ci-test-fetch.mjs` → `python3 .tool/Jenkins/fetch_ci_test.py <buildUrl> <tc> "Test Result: FAIL"`).
`.tool/`은 gitignored.

| 항목 | 값 |
|---|---|
| 사내 저장 위치 (repo/경로) | `<채우기>` |
| 설치 방법 (서버 호스트 배치 절차) | `<채우기>` |
| 요구사항 | `python3` PATH 등록 |

- **없을 때 폴백**: 스크립트 실패/부재 시 `server/jenkins.mjs`가 TEST 링크에서 샤드 콘솔을 직통
  추적하고, 그마저 실패하면 티켓 description 로그만으로 분류를 진행한다.

## 2. `.claude/skills/format-ci-log` — 로그 정형화 스킬

확보한 raw 실패 로그를 headless Claude(`claude -p "/format-ci-log <file>"`)로 지정 양식에
재조합하는 스킬 (`server/ci-test-fetch.mjs` formatLogViaSkill). `.claude/`는 gitignored.

| 항목 | 값 |
|---|---|
| 스킬 정의 위치 (사내 repo/경로) | `<채우기>` |
| 요구사항 | claude CLI — Windows 개발 환경에서는 PATH의 **네이티브 exe**여야 한다 (npm `.cmd` shim 불가) |

- **없을 때 폴백**: claude CLI 부재·타임아웃·`FORMAT_FAILED`·짧은/에러성 출력은 전부 거부되고
  raw 로그를 그대로 사용한다 (`isFormattedLog` 화이트리스트).

## 3. MCP 서버 설정 — Gerrit 후보 조회 · Jira 코멘트 기입

접속 정보는 서버 호스트의 claude MCP 설정(json)에만 두고, 코드/.env에는 이름만 쓴다.

| 항목 | 값 |
|---|---|
| Gerrit MCP 서버 이름 | `Exynos-Auto-CICD-Gerrit` (코드 고정 — `server/wiki-query.mjs` lookupGerritCommitter) |
| Gerrit MCP 엔드포인트/설정 위치 | `<채우기>` |
| Jira MCP 서버 이름 (`SVP_COMMENT_MCP_NAME`) | `<채우기>` — `SVP_COMMENT_CHANNEL=mcp`일 때만 |
| Jira MCP 엔드포인트/설정 위치 | `<채우기>` |

- **없을 때 폴백**: Gerrit 조회 실패 시 담당자 후보는 wiki 모듈 노트의 `owner:`만으로 구성된다
  (`buildCandidates`). 분석 코멘트는 이름 미설정·MCP 호출 실패 시 Jira REST로 폴백해 유실되지 않는다
  (`server/comment-channel.mjs`).

## 4. 사내 Jira / Jenkins 접속 정보

| 항목 | 값 |
|---|---|
| Jira URL (`SVP_JIRA_BASE_URL`) | `<사내 Jira URL — 채우기>` |
| Jira PAT 발급 절차 | `<채우기>` (Jira 프로필 → Personal Access Tokens) |
| 팀 JQL (`SVP_JIRA_JQL`) | `<채우기>` |
| 검증 계정 — reporter (`<사내 계정 1>`) | `<채우기>` |
| 검증 계정 — 기대 배정 (`<사내 계정 2>`) | `<채우기>` |
| Jenkins 계정/API Token (`SVP_JENKINS_USER`/`SVP_JENKINS_TOKEN`) 발급 절차 | `<채우기>` (Jenkins 프로필 → Configure → API Token) |
| 사내 CA pem 경로 (`NODE_EXTRA_CA_CERTS` — 셸/systemd `Environment=`로만) | `<채우기>` |

- **없을 때 폴백**: 미설정 시 mock 기본값(`http://localhost:8792`, 무인증)으로 동작한다 — 사외 개발 경로.

## 5. 사내 wiki-vault 시딩

서버가 분류 근거로 읽는 vault는 사내 별도 클론(`SVP_WIKI_DIR`)이다. 모듈 노트의
`module:`/`owner:` frontmatter가 분류 카테고리 enum과 담당자 매핑의 원천이다.

| 항목 | 값 |
|---|---|
| 사내 vault 위치 (`SVP_WIKI_DIR`) | `<채우기>` |
| 실모듈 노트 목록 (modules/*.md — 모듈명·owner) | `<채우기>` |

- **없을 때 폴백**: 모듈 노트가 없으면 분류 enum이 비어 모든 티켓이 `unknown` → 당번 큐 유지.
  서버는 정상 동작하며 자동 배정만 일어나지 않는다.
