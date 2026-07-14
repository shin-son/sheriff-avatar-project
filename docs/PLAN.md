# SVP 개발 계획 (2026-07-12 ~ 2026-08-01)

- 3인 개발: **손신 / 김병재 / 김민석(당번 역할 겸 통합 책임)**
- **8/1까지 모든 구현 완료**가 목표. 7/30 코드 프리즈, 이후는 버그픽스만.
- 모든 PR은 **순환 리뷰**: 손신의 PR → 김병재가 리뷰, 김병재 → 김민석, 김민석 → 손신. 리뷰 없는 merge 금지.
- 각 주 금요일: dead code 정리 + 주간 회고(계획 대비 진척, 다음 주 재조정).
- 모듈 경계는 CLAUDE.md의 모듈 맵 + [ARCHITECTURE.md](./ARCHITECTURE.md)의 목표 모듈 맵(`jira/`, `hub/`, `hub-client/`)을 따른다.
  담당 모듈이라도 경계를 넘는 변경은 사전 논의.
- 기능 번호(F1~F8)와 완료 기준은 [BACKEND.md](./BACKEND.md), 프로토콜은 [API.md](./API.md) 기준.

## Week 1 — 7/12(토) ~ 7/18(금): 기반 — 서버·클라이언트 분리 + Jira 유입

| 담당 | 개발 | 검토(리뷰) |
|---|---|---|
| 김병재 | `modules/jira/` + 서버(backend): **F1 Jira 폴러** — 신규 티켓 감지, **처리 티켓 테이블(중복 방지 저장소)** 설계·영속화, 지수 백오프 + 폴러 검증용 `mock/jira-server.mjs`(포트 8792, 데모 트리거 — [API.md §4](./API.md)) | 김민석의 PR |
| 손신 | `modules/hub/`: **F6 서버 → 클라이언트 push 전용 채널** — WS 서버(8791), hello/welcome 스냅샷, 본인 배정분만 서버 측 필터링해 push, 하트비트. 이번 주는 **단방향(push)만** — C→S 메시지(issue:ack) 배선은 다음 주 | 김병재의 PR |
| 김민석 | 클라이언트(frontend): `modules/hub-client/` 서버 접속(기존 `websocket/` 대체) + **push 수신 후 화면 구성** — `issue:assigned`/`issue:updated`를 대장·컴팩트 뷰에 반영, 재접속 시 welcome 스냅샷으로 상태 복원 | 손신의 PR |

**마일스톤 M1 (7/18):** mock Jira 기준 **폴링 → 분류(stub) → 배정 → 서버 push → 클라이언트 화면 표시**가
서버 1대 + 클라이언트 구성으로 안정 동작 (Jira 댓글·해결 감지·ingest는 Week 2).

## Week 2 — 7/19 ~ 7/25: 핵심 지능

| 담당 | 개발 | 검토(리뷰) |
|---|---|---|
| 손신 | `classifier/`: **F3 실제 LLM(Claude API) 연동** — wiki 노트를 컨텍스트로 분류/요약/신뢰도 산출 ([API.md §3](./API.md) 계약: 30초 타임아웃, 실패 시 `confidence: 0` fallback), API key 보안(.env, 사내 프록시 고려) | 김병재의 PR |
| 김병재 | `assignment/` + `hub/` + `ui/`: **F4 당번 수동 재배정**(human-in-the-loop — hub push로 기존/신규 담당자 양쪽 반영, Jira assignee 갱신 + 갱신 댓글), 배정 이력 표시 | 김민석의 PR |
| 김민석 | `wiki/` + `jira/`: **F7 해결 감지→ingest**(Jira Done 폴링 단일 경로 — [ARCHITECTURE.md](./ARCHITECTURE.md), 중복 ingest 방지) + **F8 lint/feedback 고도화**(해결 확정 시 원인 일치/불일치 toast, 감점 임계값, feedback의 hub 경유 배선) + 이슈 해결 시 LLM이 해결 코멘트 기반 case-log 작성 | 손신의 PR |

**마일스톤 M2 (7/25):** LLM 실분류 + 당번 재배정 + Jira 댓글·상태 전이가 mock 시나리오로 검증됨.
신뢰도 80점 기준 라우팅이 실데이터로 검증되고, [DEMO-SCENARIO.md](./DEMO-SCENARIO.md) 장면 1~3 리허설 가능.

## Week 3 — 7/26 ~ 8/1(토): 통합·패키징

| 담당 | 개발 | 검토(리뷰) |
|---|---|---|
| 손신 | 사내 Jira 실연동 테스트 주도 — 티켓 스키마 확정(TODO(SVP-6)), 사내에서 pull-only로 테스트, 에러 리포트를 사외로 전달해 수정. 클라이언트 WS 토큰 인증 재검토(TODO(SVP-5)) | 김병재의 PR |
| 김병재 | 배포: EXE 인스톨러 마감(아이콘/메타데이터), 자동 시작 옵션, 설치 가이드 문서(서버 모드/클라이언트 모드 구분) | 김민석의 PR |
| 김민석 | E2E 시나리오 테스트 — [DEMO-SCENARIO.md](./DEMO-SCENARIO.md) 4장면을 3인 역할극(A/B/C 각자 설치)으로 검증, 문서 최신화, 버그픽스 | 손신의 PR |

- **7/30(목): 코드 프리즈** — 이후 fix/docs 커밋만 허용.
- **마일스톤 M3 (8/1):** v1.0.0 태그, 전 팀원 EXE 설치 완료, CLAUDE.md/문서가 코드와 일치.

## 범위 제외 (8/1 이후)

- 자동 업데이트(auto-updater)
- 멀티팀 지원
- 클라이언트 토큰 인증 (v1은 사내망 신뢰 기반 — Week 3 재검토 결과에 따라 편입 가능)
