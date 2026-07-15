# SVP 실행·설정 가이드

> 개발(mock)과 사내 Jira 실연동 테스트의 실행 방법. 배경 구조는 [ARCHITECTURE.md](./ARCHITECTURE.md),
> 프로토콜은 [API.md](./API.md) 참고.
> **사내 실제 값(URL·PAT·JQL)은 이 repo 어디에도 커밋하지 않는다** (CLAUDE.md 절대 규칙 4).
> 실제 값 모음은 사내 팀 노트에만 둔다.

## 요구사항

- Node.js 20+ / git
- 사내 테스트: Jira Personal Access Token (Jira 프로필 → Personal Access Tokens에서 발급)
- 사내 PC에서는 repo를 **pull만** 한다 — 코드 수정·push는 사외에서만 (CLAUDE.md 절대 규칙 2)

## 설정 (.env)

프로젝트 루트의 `.env` 파일을 앱이 시작 시 읽는다 (셸 환경변수가 있으면 그쪽이 우선).

```bash
cp .env.example .env    # Windows: copy .env.example .env
```

| 변수 | 기본값 | 설명 |
|---|---|---|
| `SVP_JIRA_BASE_URL` | `http://localhost:8792` (mock) | Jira 베이스 URL |
| `SVP_JIRA_PAT` | (없음) | Personal Access Token — Bearer 인증 |
| `SVP_JIRA_PROJECT` / `SVP_JIRA_LABEL` | `CIOPS` / `ci-failure` | 기본 필터 (`project = X AND labels = Y`) |
| `SVP_JIRA_JQL` | (없음) | 기본 필터를 통째로 대체하는 JQL. 설정 시 PROJECT/LABEL 무시. ORDER BY는 서버가 자동으로 붙이므로 **넣지 않는다** |
| `SVP_JIRA_BOT` | `cicd_ap` | "사람 배정 전" 취급하는 bot 계정 — 이 assignee면 당번 큐로 라우팅 |
| `SVP_SERVER_POLL_MS` | `5000` | v3 서버 폴링 주기(ms) |
| `SVP_PUSH_URL` | `http://localhost:8793` | 중앙 서버 Socket.IO 주소 — **앱에 필요한 유일한 설정** (서버가 원격이면 그 주소로) |
| `NODE_EXTRA_CA_CERTS` | (없음) | 사내 자체 CA pem 경로. **`.env`로는 동작하지 않음** — Node가 프로세스 시작 시 읽으므로 셸에서 직접 설정 |

## 사외 개발 (mock)

```bash
npm install
npm run mock:jira        # 터미널 1 — mock Jira (포트 8792, 시드 티켓 3건, assignee=cicd_ap)
npm run mock:server      # 터미널 2 — v3 서버 프로토타입 (포트 8793) — 폴링·배정·push
npm run dev              # 터미널 3 — 앱 (로그인: admin/admin = 당번, 아이디=비밀번호 = 팀원)
```

- 당번+팀원 동시 확인: `npm run dev`를 한 번 더 실행 (Vite가 다음 포트를 자동 사용, 캐시 경고는 무해)
- 담당자 배정 재현: `curl -X PUT localhost:8792/rest/api/2/issue/<KEY>/assignee -d '{"name":"shin.son"}'`
  → 다음 폴링에서 그 계정으로 로그인한 앱에 push된다

- 새 티켓 흘리기: `curl -X POST localhost:8792/demo/trigger -d '{"scenario":"payment-e2e"}'`
  (시나리오 목록은 `mock/jira-server.mjs` 상단)
- 해결 재현: `curl -X POST localhost:8792/demo/resolve -d '{"key":"CIOPS-1004","comment":"원인 수정"}'`
- 기존 mock CI 경로도 병존: `npm run mock:ci` (WebSocket push)

## 사내 실연동 테스트

**Jira 접속(인증서·PAT·JQL)은 전부 서버 프로세스 몫이다.** 앱에는 자격증명이 하나도 필요 없다 —
앱 설정은 `SVP_PUSH_URL`(서버 주소) 하나뿐이고, 로컬에서 서버를 함께 띄우면 그것도 기본값으로 충분하다.

1. 서버 실행 전에 curl로 계약 검증 (인증 → 검색 순):

```bash
curl -s -H "Authorization: Bearer $PAT" "$JIRA/rest/api/2/myself"
curl -s -G -H "Authorization: Bearer $PAT" "$JIRA/rest/api/2/search" \
  --data-urlencode "jql=<팀 CI 티켓 필터>" \
  --data-urlencode "fields=summary,description,labels,status,created,assignee"
```

2. `.env`에 실제 값 기입 (한 번만) 후, **서버 터미널**에서:

```powershell
$env:NODE_EXTRA_CA_CERTS = "C:\path\사내CA.pem"   # 셸에서 — .env로는 동작하지 않음
npm run mock:server
```

- 정상 지표: `[svp-server] jira=https://<사내 Jira> ... jql=<팀 JQL>` + 초기 티켓 `new OOOO-...` 로그.
  `jira=http://localhost:8792`로 나오면 `.env`를 못 읽은 것 (프로젝트 루트에서 실행했는지 확인).

3. **앱 터미널**: `npm run dev` → 로그인 (당번: `admin/admin`, 팀원: Jira 계정명 = 비밀번호).
   담당자 배정 테스트: Jira에서 티켓 assignee를 팀원 계정으로 변경 → 다음 폴링(5초)에 해당 앱으로 push.

- JQL의 상태명 등은 Jira에 등록된 정확한 이름이어야 한다 (`GET /rest/api/2/status`로 목록 확인 가능)

## 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| `jira=http://localhost:8792` (사내인데 mock 주소) | env 미전달 — `.env` 없음 또는 루트 밖에서 실행 | 프로젝트 루트에서 `.env` 확인 후 재실행 |
| 앱 로그인 실패 "서버에 연결할 수 없습니다" | 서버(8793) 미실행 | `npm run mock:server` 먼저 |
| 앱에 `[svp:push] connect error: xhr poll error` 반복 | 8793에 서버 없음 (또는 포트 충돌 — `mock:push`와 동시 실행 금지) | 서버 실행/포트 확인 |
| `poll failed ...: fetch failed (cause: ...)` | 네트워크/TLS — cause 코드로 판별: `UNABLE_TO_VERIFY...`/`SELF_SIGNED...` = CA 미신뢰, `ECONNREFUSED` = 주소, `ENOTFOUND` = DNS | TLS면 **서버 터미널** 셸에서 `NODE_EXTRA_CA_CERTS=<사내CA.pem>` 설정 (경로 오타 시 시작 로그에 `Warning: ... load failed`) |
| `poll failed ...: search returned 401` | PAT 누락/오류 | `.env`의 `SVP_JIRA_PAT` 확인 |
| `poll failed ...: search returned 400` | JQL 문법·상태명 오류 | curl로 같은 JQL 실행해 `errorMessages` 확인 |
| 배정했는데 팀원 앱에 안 옴 | 로그인 아이디 ≠ Jira assignee name | 서버 로그의 `sync ...: assignee=<값>`과 로그인 아이디 대조 |

v3 서버 프로토타입은 이슈를 메모리로 추적한다 — 서버를 재시작하면 Jira를 다시 읽어 현재 상태로 복원된다.
(v2 앱 내장 폴러의 중복 방지 저장소 `%APPDATA%\sheriff-avatar-project\svp-processed-tickets.json`은 v2 전용.)
