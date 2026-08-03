# SVP 개발 계획 — 완료 기록 (2026-07-12 ~ 2026-08-03)

3인 공동 개발 (손신 / 김병재 / 김민석 — 당번 역할 겸 통합 책임).
PR은 순환 리뷰(손신→김병재→김민석→손신) 방식으로 운영했다.

## 결과 요약

| 주차 | 목표 | 결과 |
|---|---|---|
| Week 1 (7/12~7/18) | 서버·클라이언트 분리 + Jira 폴링 유입 (F1, F6, 클라이언트 수신) | ✅ M1 달성 — mock Jira 기준 폴링→분류(stub)→배정→push→화면 표시 |
| Week 2 (7/19~7/25) | 핵심 지능 — LLM 실분류(F3), 수동 재배정(F4), 해결 감지→ingest(F7), feedback(F8) | ✅ M2 달성 — 실분류 + Jira write 3종 + ingest가 mock 시나리오로 검증. F8은 부분 구현 ([BACKEND.md](./BACKEND.md)) |
| Week 3 (7/26~8/1) | 통합 — 사내 Jira dry-run 검증, EXE 패키징, E2E 시나리오, 문서 정합화 | ✅ 7/30 코드 프리즈, 이후 fix/docs만. **사내 dry-run 검증 완료 · live 쓰기 전환은 사내 반입 후** |

기능 번호(F1~)와 완료 기준·검증 방법은 [BACKEND.md](./BACKEND.md), 현행 구조는 [ARCHITECTURE.md](./ARCHITECTURE.md) 기준.
서버 순수 함수 단위 테스트 49개 통과 (`npm test`).

## 주차별 개발 로그 (git 이력 기준)

### Week 1 (7/12~7/18) — 골격과 v3 전환

- 7/12 스캐폴드(Electron + React + wiki 4대 동작 골격) → 7/13 v2(클라이언트-서버 + Jira) 아키텍처 스펙 → 7/14 hub push 채널(F6)·hub-client·mock Jira·F1 폴러를 공개 API를 먼저 고정하고 병렬로 구현.
- 7/15 **v3 전환 결정** — 폴링·분류·배정을 headless Linux 서버로 옮기고, 앱은 로그인·push 수신 전용 순수 클라이언트로. v3 서버 프로토타입과 로그인 주도 클라이언트를 같은 날 연결.
- 7/16 서버를 `server/`로 승격, wiki query·frontmatter owner 해석 이식, Claude 분류기(Bedrock) 연결, 고신뢰 자동 배정까지 관통. **모든 Jira write는 처음부터 `SVP_JIRA_WRITE_MODE` 게이트 뒤에** 두었다.
- UI는 tin-star ledger 컨셉으로 재설계 (frameless·acrylic 창, 역할별 창 크기의 팀원 컴팩트 뷰).

### Week 2 (7/19~7/25) — 로그 수집 사슬과 ingest

- 7/20 해결 티켓 ingest(F7) — raw 동결 + case-log append, symptom/cause/resolution은 LLM(summarizeResolution)이 작성.
- 7/21 Jenkins 로그 사슬 구축 — 티켓의 CI TEST RESULT 링크 → 실패 샤드 콘솔 → 해당 TC 실행 구간만 추출. 사내 티켓 description 실계약(SVP-6) 반영.
- 7/21~22 실환경성 문제 해결: env proxy 우회 직접 HTTP 호출, `api/json` 500 시 빌드 페이지 HTML 폴백, GET 재시도·샤드 메타 직렬화, **poll 겹침은 single-flight로 차단**, HTML description 파싱.
- 7/22~23 분석 캐시 도입으로 재시작 시 재분류 방지, 1차 로그 수집을 사내 python tool(`.tool/`) + format-ci-log 스킬 경로로 확장. ROI 추정 문서 작성.
- UI 대시보드를 cockpit deck(트리아지 보드 + 커맨드 팔레트)으로 재구축, DESIGN.md 명세.

### Week 3 (7/26~8/1) — human-in-the-loop 완성과 정합화

- 7/27 수동 재배정(F4)·assignee picker, 전 분류 티켓 분석 댓글(MCP 채널 + REST 폴백), Gerrit 커미터·wiki owner 융합 담당자 후보, LLM 노트 선택 드릴다운(SVP-3).
- 7/29 retrieval 자기교정 — reopen 재해결 supersede, ingest dedup(같은 실패 서명은 포인터로 축약), 노트 피드백 👍/👎 수집과 query 감점.
- 7/30 **코드 프리즈** — 문서 정합화(architecture/API/wiki 스키마), 서버측 read-only lint(`wiki:lint` 소켓), 단위 테스트 이식, **confidence 밴드 캘리브레이션**(직접 매칭이 80 게이트를 넘도록), dead v2 모듈 제거.
- 7/31~ 사내 dry-run에서 나온 fix — **사내 Jira가 표시명 assignee를 400으로 거부 → 편집 엔드포인트 폴백(실측 확인)**, 느린 신규 티켓 수집과 tracked-key 동기화 분리, 진행 중이던 poll의 사후 재실행, **로그인 replay race**(재접속 burst 전에 이슈 클리어), 캐시 복원 티켓의 자동 배정 재실행.

## 범위 제외 (v1 이후)

- 자동 업데이트(auto-updater)
- 멀티팀 지원
- 클라이언트 토큰 인증 (v1은 사내망 신뢰 기반)
- known-failure 승격 초안 PR 자동 생성 (ingest는 case-log까지 — [wiki-vault/README.md](../wiki-vault/README.md))
