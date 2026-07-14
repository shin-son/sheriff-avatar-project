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
| `SVP_JIRA_JQL` | (없음) | 기본 필터를 통째로 대체하는 JQL. 설정 시 PROJECT/LABEL 무시. created 조건·ORDER BY는 폴러가 자동으로 붙이므로 **넣지 않는다** |
| `SVP_JIRA_POLL_MS` | `30000` | 폴링 주기(ms). 테스트 시 10000 권장 |
| `SVP_CI_WS_URL` | `ws://localhost:8790` | 기존 mock CI WebSocket (개발용 병존) |
| `NODE_EXTRA_CA_CERTS` | (없음) | 사내 자체 CA pem 경로. **`.env`로는 동작하지 않음** — Node가 프로세스 시작 시 읽으므로 셸에서 직접 설정 |

## 사외 개발 (mock)

```bash
npm install
npm run mock:jira        # 터미널 1 — mock Jira (포트 8792, 시드 티켓 3건)
npm run dev              # 터미널 2
```

- 새 티켓 흘리기: `curl -X POST localhost:8792/demo/trigger -d '{"scenario":"payment-e2e"}'`
  (시나리오 목록은 `mock/jira-server.mjs` 상단)
- 해결 재현: `curl -X POST localhost:8792/demo/resolve -d '{"key":"CIOPS-1004","comment":"원인 수정"}'`
- 기존 mock CI 경로도 병존: `npm run mock:ci` (WebSocket push)

## 사내 실연동 테스트

**폴러는 당번(sheriff) 역할일 때만 돈다.** 앱에서 당번 계정이 선택되어 있는지 확인할 것.

1. 앱 실행 전에 curl로 계약 검증 (인증 → 검색 순):

```bash
curl -s -H "Authorization: Bearer $PAT" "$JIRA/rest/api/2/myself"
curl -s -G -H "Authorization: Bearer $PAT" "$JIRA/rest/api/2/search" \
  --data-urlencode "jql=<팀 CI 티켓 필터>" \
  --data-urlencode "fields=summary,description,labels,status,created,assignee"
```

2. `.env`에 실제 값 기입 (한 번만) 후 실행:

```powershell
# Windows PowerShell
npm install
npm run dev
```

- 정상 지표: 터미널에 `[svp:jira] polling https://<사내 Jira> every ...ms`
- JQL의 상태명 등은 Jira에 등록된 정확한 이름이어야 한다 (`GET /rest/api/2/status`로 목록 확인 가능)

## 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| `polling http://localhost:8792` (사내인데 mock 주소) | env 미전달 — `.env` 없음 또는 다른 셸에서 export | `.env` 확인, 또는 같은 창에서 export 후 실행 |
| `[svp:jira]` 로그가 아예 없음 | member 역할 — 폴러는 sheriff 전용 | 앱에서 당번 계정 선택 후 재시작 |
| `poll failed ...: fetch failed` | 네트워크/TLS — 사내 자체 CA를 Node가 신뢰 안 함 | 셸에서 `NODE_EXTRA_CA_CERTS=<사내CA.pem>` 설정 (curl은 OS 인증서를 쓰므로 curl만 되는 상황이 이 케이스) |
| `poll failed ...: search returned 401` | PAT 누락/오류 | `.env`의 `SVP_JIRA_PAT` 확인 |
| `poll failed ...: search returned 400` | JQL 문법·상태명 오류 | curl로 같은 JQL 실행해 `errorMessages` 확인 |
| 폴링 정상인데 "아직 이슈가 없습니다" | 이미 분류된 티켓 (중복 방지 저장소) | 저장소 삭제 후 재시작 — 아래 참고 |
| 첫 실행에 옛 티켓이 대량 유입 | 첫 폴링은 시간 제한 없음 (이후 증분) | 정상. 원치 않으면 한 번 띄웠다 재시작 (처리분은 기록됨) |

중복 방지 저장소(처리 티켓 기록) 위치 — 삭제하면 티켓이 다시 유입된다:

```
Windows:  %APPDATA%\sheriff-avatar-project\svp-processed-tickets.json
Linux:    ~/.config/sheriff-avatar-project/svp-processed-tickets.json
```
