# SVP 실행·설정 가이드

> 개발(mock)과 사내 Jira 실연동 테스트의 실행 방법. 배경 구조는 [ARCHITECTURE.md](./ARCHITECTURE.md),
> 프로토콜은 [API.md](./API.md) 참고.
> **사내 실제 값(URL·PAT·JQL)은 이 repo 어디에도 커밋하지 않는다** (CLAUDE.md 절대 규칙 4).
> 실제 값은 [docs/INTERNAL-ASSETS.md](./INTERNAL-ASSETS.md) 템플릿에 채워 사내에서만 관리한다.

## 요구사항

- Node.js 20+ / git
- 사내 테스트: Jira Personal Access Token (Jira 프로필 → Personal Access Tokens에서 발급)
- 사내 PC에서는 repo를 **pull만** 한다 — 코드 수정·push는 사외에서만 (CLAUDE.md 절대 규칙 2)
- (선택 — 사내 전용) `python3` + `.tool/Jenkins/fetch_ci_test.py`(1차 CI 로그 수집),
  claude CLI + `.claude/skills/format-ci-log`(로그 정형화), Gerrit MCP(담당자 후보 조회).
  전부 gitignored 사내 자산이며, 없으면 각각 Jenkins 직통 수집 / raw 로그 그대로 / wiki owner
  후보만으로 자동 강등되어 동작에는 지장 없다. 상세는 [docs/INTERNAL-ASSETS.md](./INTERNAL-ASSETS.md)

## 설정 (.env)

프로젝트 루트의 `.env` 파일을 서버와 앱 모두 시작 시 읽는다 (셸 환경변수가 있으면 그쪽이 우선).

```bash
cp .env.example .env    # Windows: copy .env.example .env
```

| 변수 | 기본값 | 설명 |
|---|---|---|
| `SVP_JIRA_BASE_URL` | `http://localhost:8792` (mock) | Jira 베이스 URL (서버 전용) |
| `SVP_JIRA_PAT` | (없음) | Personal Access Token — Bearer 인증 (서버 전용) |
| `SVP_JIRA_JQL` | `project = CIOPS AND labels = ci-failure` (mock용) | 팀 CI 티켓 필터 JQL. ORDER BY는 서버가 자동으로 붙이므로 **넣지 않는다** |
| `SVP_JIRA_BOT` | `cicd_ap` | "사람 배정 전" 취급하는 bot 계정 — 이 assignee면 당번 큐로 라우팅 |
| `SVP_JENKINS_USER` / `SVP_JENKINS_TOKEN` | (없음) | Jenkins Basic auth (계정 + API Token — 프로필 → Configure에서 발급). 미설정이면 인증 헤더 없이 시도 (mock용). 티켓 description의 빌드 링크에서 콘솔 로그 꼬리를 가져와 분류·ingest 로그를 보강 — 링크 없음/실패 시 description 로그로 폴백 |
| `SVP_JENKINS_LOG_TAIL` | `6000` | 콘솔 꼬리 폴백(TC 구간을 못 찾을 때)의 유지 크기(chars). 찾은 TC 구간은 통짜 보존된다 |
| `SVP_JENKINS_TIMEOUT_MS` | `15000` | Jenkins HTTP 타임아웃(ms) — 샤드 콘솔이 ~9MB라 다운로드 여유 포함 |
| `SVP_LLM_PROVIDER` | `bedrock` | 분류기 LLM 경로 — `bedrock`(Messages 엔드포인트) / **`bedrock-invoke`(표준 Bedrock InvokeModel — 사내처럼 Mantle이 막힌 환경)** / `anthropic`(사외 dev). 코드 기본값은 `bedrock`이지만 `.env.example`은 사내 기준인 `bedrock-invoke`를 기입해 둔다 |
| `SVP_LLM_MODEL` | provider별 기본 | `bedrock-invoke` 기본값은 `global.anthropic.claude-opus-4-8` (global inference profile — on-demand ID는 400). 환경이 다르면 콘솔의 ID로 교체 |
| `SVP_LLM_TIMEOUT_MS` | `30000` | LLM SDK 클라이언트 타임아웃(ms) — 분류·노트 선택·해결 요약 호출 공통 |
| `AWS_REGION` | (없음) | Bedrock 리전. **미설정이면 분류기 비활성** — 티켓은 당번 큐에 유지되고 서버는 정상 동작 |
| `SVP_ANTHROPIC_API_KEY` | (없음) | `SVP_LLM_PROVIDER=anthropic`일 때만 |
| `SVP_LLM_CONFIDENCE_MIN` | `80` | 이 점수 **초과**여야 자동 배정 (assignee+댓글+In Progress) |
| `SVP_JIRA_WRITE_MODE` | **`dry-run`** | 서버발 Jira write 전부(자동 배정 + ack 전이)의 게이트: `dry-run`=로그만 / `label`=`SVP_TEST_LABEL` 티켓만 / `live`=전면 |
| `SVP_INGEST_MODE` | **`dry-run`** | 해결된 티켓의 vault 반영(F7: raw 동결 + case-log 기록) 게이트: `dry-run`=로그만(vault 안 건드림) / `live`=실제 기록. 데모의 case-log 실시간 갱신 컷은 `live` 필요 |
| `SVP_DEDUP_WINDOW_DAYS` | `14` | ingest dedup 시간창(일): 같은 실패 서명·같은 모듈의 새 티켓이 이 기간 내에 해결되면 case-log에 풀 엔트리 대신 anchor 포인터(재발 추정, 누적 카운트)로 기록 |
| `SVP_RECUR_BOOST_CAP` | `4` | query 시 재발 가중 상한 — 재발 count가 n인 anchor 엔트리는 점수 `+min(n-1, cap)` |
| `SVP_FEEDBACK_DEMOTE` | `3` | 👎(원인 불일치) 누적이 이 값 이상이고 👍보다 많은 노트는 query 점수 반감 (F8) |
| `SVP_COMMENT_CHANNEL` | `rest` | 분석 코멘트 전송 채널: `rest`=Jira REST 직접 / `mcp`=headless claude가 MCP 서버의 Jira 툴로 기입 (서버 호스트에 claude CLI + MCP 설정 json 필요). 이름 미설정·호출 실패 시 REST 폴백. write 게이트를 따른다 |
| `SVP_COMMENT_MCP_NAME` | (없음) | claude MCP 설정(json)에 등록된 MCP 서버 이름 — `mcp` 채널이 `--allowedTools Read,mcp__<이름>`으로 호출 |
| `SVP_TEST_LABEL` | `svp-test` | `label` 모드에서 write를 허용하는 Jira 라벨 |
| `SVP_WIKI_DIR` | `<repo>/wiki-vault` | 서버가 분류 근거로 읽는 vault 경로. **앱도 인식** (선택) — 설정 시 "위키 열기/점검"이 이 경로(공유 vault)를 사용. 미설정 시 EXE는 설치 시점의 번들 스냅샷을 열므로 서버 vault와 어긋난다. **Obsidian 사용 시 머신당 최초 1회** 해당 폴더를 "Open folder as vault"로 등록해야 한다 — 미등록이면 `obsidian://` 열기가 "Unable to find a vault" 에러를 띄운다 (URI는 등록된 vault만 연다) |
| `SVP_DEBUG_DUMP_DIR` | (없음 — 꺼짐) | 설정 시 신규 티켓의 수집 로그(description + Jenkins 구간)를 `<dir>/<티켓키>.log`로 저장 — ingest 전 수집 데이터 검증용 |
| `SVP_SERVER_PORT` | `8793` | 서버 Socket.IO 리슨 포트 |
| `SVP_SERVER_POLL_MS` | `5000` | 서버 폴링 주기(ms) |
| `SVP_PUSH_URL` | `http://localhost:8793` | 중앙 서버 Socket.IO 주소 — **앱에 필요한 유일한 설정** (서버가 원격이면 그 주소로) |
| `SVP_GLASS` | (미설정) | 앱 창 모드(앱 전용): 미설정=acrylic(Win11 미만은 solid) / `frameless`=투명 프레임리스 / `solid`=불투명 강제 — 화면 녹화 시 창 뒤 바탕화면이 찍히지 않게 한다 |
| `NODE_EXTRA_CA_CERTS` | (없음) | 사내 자체 CA pem 경로. **`.env`로는 동작하지 않음** — Node가 프로세스 시작 시 읽으므로 셸(systemd는 `Environment=`)에서 설정 |

## 사외 개발 (mock)

```bash
npm install
npm run mock:jira        # 터미널 1 — mock Jira (포트 8792, 시드 티켓 3건, assignee=cicd_ap)
npm run mock:jenkins     # 터미널 2 — mock Jenkins (포트 8794) — 시드 티켓의 ci-url이 여길 가리킴 (없어도 동작 — description 로그로 폴백)
npm run server           # 터미널 3 — v3 서버 (포트 8793) — 폴링·배정·push
npm run dev              # 터미널 4 — 앱 (로그인: admin/admin = 당번, 아이디=비밀번호 = 팀원)
```

- 당번+팀원 동시 확인: `npm run dev`를 한 번 더 실행 (Vite가 다음 포트를 자동 사용, 캐시 경고는 무해)
- 담당자 배정 재현: `curl -X PUT localhost:8792/rest/api/2/issue/<KEY>/assignee -d '{"name":"alice"}'`
  → 다음 폴링에서 그 계정으로 로그인한 앱에 push된다

- 새 티켓 흘리기: `curl -X POST localhost:8792/demo/trigger -d '{"scenario":"payment-e2e"}'`
  (시나리오 목록은 `mock/jira-server.mjs` 상단)
- 해결 재현: `curl -X POST localhost:8792/demo/resolve -d '{"key":"CIOPS-1004","comment":"원인 수정"}'`

## 검증 명령

```bash
npm run typecheck    # 타입 체크 — 커밋 전 필수
npm test             # node --test — server 순수 함수 22개 테스트 (ingest dedup·재발 가중·피드백 감점·스킬 출력 판정)
```

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
npm run server
```

- 정상 지표: `[svp-server] jira=https://<사내 Jira> ... jql=<팀 JQL>` + 초기 티켓 `new OOOO-...` 로그.
  `jira=http://localhost:8792`로 나오면 `.env`를 못 읽은 것 (프로젝트 루트에서 실행했는지 확인).

3. **앱 터미널**: `npm run dev` → 로그인 (당번: `admin/admin`, 팀원: Jira 계정명 = 비밀번호).
   담당자 배정 테스트: Jira에서 티켓 assignee를 팀원 계정으로 변경 → 다음 폴링(5초)에 해당 앱으로 push.

- JQL의 상태명 등은 Jira에 등록된 정확한 이름이어야 한다 (`GET /rest/api/2/status`로 목록 확인 가능)

## Linux 서버 배포 (사내 운영)

서버의 정식 운영 위치는 사내 상시 가동 Linux 호스트다 (v3 — [ARCHITECTURE.md](./ARCHITECTURE.md)).
요구사항: Node.js 20+, 아웃바운드 HTTPS(사내 Jira), 인바운드 8793/tcp (팀원 PC → 서버).

```bash
# 1) 코드 + 런타임 의존성만 설치 (Electron 등 devDependencies 제외 — GUI 불필요)
sudo mkdir -p /opt/svp && cd /opt/svp
git clone <repo-url> sheriff-avatar-project && cd sheriff-avatar-project   # 이후엔 git pull (pull-only)
npm ci --omit=dev

# 2) 설정 — .env에 실제 값 (커밋 금지)
cp .env.example .env && vi .env    # SVP_JIRA_BASE_URL / SVP_JIRA_PAT / SVP_JIRA_JQL / SVP_JIRA_BOT
                                   # + LLM 분류기: AWS_REGION (Bedrock 자격증명은 인스턴스 프로필/env 체인)

# 3) 동작 확인 (포그라운드)
npm run server
#    [svp-server] jira=https://<사내 Jira> ... 로그와 초기 티켓 유입 확인 후 Ctrl-C

# 4) systemd 서비스 등록 (서비스 계정 svp 기준 — server/svp-server.service의 User/경로를 환경에 맞게 수정)
sudo cp server/svp-server.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now svp-server
journalctl -u svp-server -f       # 로그 확인
```

- **사내 자체 CA**: `NODE_EXTRA_CA_CERTS`는 `.env`로 지정할 수 없으므로 유닛 파일의 `Environment=` 줄
  (주석 참고)을 활성화한다.
- **사내 도입은 3단계로**: ① 기본값 `SVP_JIRA_WRITE_MODE=dry-run`으로 가동 — 실티켓은 하나도 안 바뀌고
  `journalctl`의 `would assign → <담당자> (<모듈>/<신뢰도>)` 로그로 분류 품질만 관찰 →
  ② 테스트 티켓에 `svp-test` 라벨을 붙이고 `label` 모드로 전체 루프(배정·댓글·전이·push) 검증 →
  ③ 팀 합의 후 `live`.
- **업데이트 배포**: `git pull && npm ci --omit=dev && sudo systemctl restart svp-server`
- 서버는 이슈를 메모리로 추적하므로 재시작하면 Jira를 다시 읽어 현재 상태로 복원된다 — 별도 백업 불필요.
- 클라이언트(전원 Windows 앱)는 `.env`의 `SVP_PUSH_URL=http://<서버호스트>:8793` 한 줄만 바꾸면 된다.

## 사내 검증 시나리오 — 가짜 티켓으로 자동 배정+댓글 확인

실 Jira에서 write(배정·댓글·전이)가 실제로 동작하는지, **가짜 티켓 하나만으로** 안전하게 확인하는 절차.
`<사내 계정 1>`(reporter)·`<사내 계정 2>`(기대 배정 결과) 등 사내 값은
[docs/INTERNAL-ASSETS.md](./INTERNAL-ASSETS.md) 템플릿에 채워 관리한다 — 이 문서에는 자리표시자만 둔다.

> **중요**: 가짜 티켓의 시작 assignee는 **비워두거나 bot(cicd_ap)** 이어야 한다.
> 사람이 이미 배정된 티켓은 분류 대상에서 제외된다 — `<사내 계정 2>`는 티켓에 미리 넣는 값이 아니라
> **자동 배정의 기대 결과**이고, 그 근거는 vault 노트의 `owner:` 필드다.

1. **vault에 테스트 노트** — 서버의 `SVP_WIKI_DIR` 안에 `modules/svp-selftest.md`:

   ```markdown
   ---
   type: module
   module: svp-selftest
   owner: <사내 계정 2>
   tags: [selftest]
   updated: 2026-07-16
   ---

   # svp-selftest 모듈

   ## Known failures

   ### SVP selftest marker

   - symptom: SvpSelftest.test_auto_assign 실패 — ERROR_SVP_SELFTEST_MARKER
   - cause: SVP 자동 배정 파이프라인 검증용 가짜 실패
   - fix: 없음 (검증 후 티켓/노트 삭제)
   - confidence-hint: 이 마커가 보이면 svp-selftest로 확정 배정 가능
   ```

2. **테스트 티켓 준비** — 새로 만들거나, **기존 티켓(assignee=cicd_ap) 하나를 재활용**해
   내용을 편집해도 된다. 어느 쪽이든:
   - assignee: **비움 또는 cicd_ap** (사람 배정 상태면 분류가 안 돈다), label: `svp-test`
   - 재활용 시에도 3번의 JQL에 `labels = svp-test`를 꼭 포함 — reporter/assignee 조건만으로는
     매칭 티켓 전부가 LLM 분류 대상이 된다 (write는 안 나가지만 호출 비용·로그 홍수)
   - summary: `SvpSelftest.test_auto_assign 실패 (ERROR_SVP_SELFTEST_MARKER)`
     — wiki 검색은 **제목 단어 기준**이라 노트 symptom의 원문 단어가 제목에 있어야 매칭된다
   - description (선택 — 노트 매칭은 제목 키워드·노트 신호 기반이다. Jira 유입 티켓의 module은
     normalize가 `unknown`으로 고정하므로 module +3점 매칭은 발동하지 않는다):

     ```
     type: test_failed
     module: svp-selftest
     log:
     AssertionError: ERROR_SVP_SELFTEST_MARKER — SVP 파이프라인 검증용
     ```

3. **서버 env — 이중 안전장치** (테스트 세션 동안만):

   ```bash
   SVP_JIRA_JQL=project = <프로젝트> AND reporter = <사내 계정 1> AND labels = svp-test  # ① 이 티켓만 보임
   SVP_JIRA_WRITE_MODE=label                                                            # ② 그중 svp-test만 write
   AWS_REGION=<리전>
   ```

4. **기대 결과** (`journalctl -u svp-server -f` 또는 포그라운드 로그):
   1. `new <KEY> assignee=- → admin` — 당번 큐 유입
   2. 수 초 내 `classified <KEY>: svp-selftest/9x → assignee=<사내 계정 2>`
   3. **Jira 화면**: assignee=`<사내 계정 2>` + "🤖 Sheriff Avatar 자동 분석" 댓글 + In Progress
   4. `<사내 계정 2>`(=비밀번호) 로그인 앱에 티켓 push
   - 음성 대조군: 노트와 무관한 가짜 티켓 하나 더 → `→ 당번 유지` 로그만, write 없음

5. **정리**: 가짜 티켓 Done/삭제, `modules/svp-selftest.md` 삭제, `.env`를 팀 JQL + `dry-run`으로 복귀.

## 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| `jira=http://localhost:8792` (사내인데 mock 주소) | env 미전달 — `.env` 없음 또는 루트 밖에서 실행 | 프로젝트 루트에서 `.env` 확인 후 재실행 |
| 앱 로그인 실패 "서버에 연결할 수 없습니다" | 서버(8793) 미실행 또는 `SVP_PUSH_URL` 오설정 | `npm run server`(원격이면 systemd 상태) 확인 |
| 앱에 `[svp:push] connect error: xhr poll error` 반복 | 8793에 서버 없음 | 서버 실행/포트 확인 |
| `poll failed ...: fetch failed (cause: ...)` | 네트워크/TLS — cause 코드로 판별: `UNABLE_TO_VERIFY...`/`SELF_SIGNED...` = CA 미신뢰, `ECONNREFUSED` = 주소, `ENOTFOUND` = DNS | TLS면 **서버 터미널** 셸에서 `NODE_EXTRA_CA_CERTS=<사내CA.pem>` 설정 (경로 오타 시 시작 로그에 `Warning: ... load failed`) |
| `poll failed ...: search returned 401` | PAT 누락/오류 | `.env`의 `SVP_JIRA_PAT` 확인 |
| `poll failed ...: search returned 400` | JQL 문법·상태명 오류 | curl로 같은 JQL 실행해 `errorMessages` 확인 |
| `jenkins api/json failed ...: 500 <!DOCTYPE HTML>...` (차단 페이지) | `NODE_USE_ENV_PROXY=1`(Bedrock용)로 인해 fetch가 사내 프록시를 타고, 프록시가 내부 Jenkins IP를 차단 | 서버 코드가 Jenkins만 `node:http` 직통으로 호출하므로 최신 코드면 발생하지 않음. 단발 `node -e "fetch(...)"` 진단은 플래그 유무에 따라 결과가 달라지니 주의 |
| 배정했는데 팀원 앱에 안 옴 | 로그인 아이디 ≠ Jira assignee name | 서버 로그의 `sync ...: assignee=<값>`과 로그인 아이디 대조 |

v3 서버는 티켓 상태를 Jira에서 재조회해 복원하고, 초도분석 결과(Jenkins 보강 로그·LLM 분류)는
`server/issue-cache.json`에 캐시된다 — mock Jira를 재기동해 티켓 키가 재사용될 때는 이 파일을
지워야 새 티켓이 다시 분석된다.
