# SVP 아키텍처

## 데이터 흐름

```
사내 CI/CD ──(WebSocket)──▶ websocket/client.ts
                                   │  CIEvent
                                   ▼
                            wiki/index.ts ──── wiki-vault/*.md 검색 (관련 노트)
                                   │  WikiMatch[]
                                   ▼
                            classifier/index.ts   ← TODO: 실제 LLM(Claude API) 호출
                                   │  Classification { category, severity, confidence(0~100), summary }
                                   ▼
                            assignment/router.ts
                                   │  confidence > 80 → feature owner
                                   │  confidence ≤ 80 → sheriff (human-in-the-loop)
                                   ▼
                              SheriffIssue
                              ├──▶ renderer 대시보드 (IPC 'issue:new')
                              └──▶ notifications/toast.ts → 우하단 팝업 창
```

## 가시성 규칙 & 뷰 모드

- role = `member`: **컴팩트 창**(420×640) — 자기에게 배정된 이슈만 표시/알림
- role = `sheriff`: **전체 대시보드**(1180×760) — 팀 전체의 모든 이슈 표시/알림
- 역할 전환 시 메인 프로세스가 창 크기를 자동 변경한다 (`WINDOW_SIZE` in `src/main/index.ts`)
- 필터링은 renderer에서 현재 사용자 기준으로 수행 (스켈레톤 단계).
  실서비스에서는 서버 측 필터링으로 전환 예정.

## 이슈 라이프사이클

`new` → `acknowledged` (담당자 확인) → `resolved` (처리 완료)

`resolved` 시점에 `wiki/appendCaseLog()`가 `wiki-vault/case-log.md`에 케이스를 기록한다.
이 기록이 쌓여 다음 분류의 신뢰도를 높이는 것이 llm-wiki 루프의 핵심이다.

## 향후 계획 (스켈레톤 범위 밖)

- classifier의 LLM 실호출 (Claude API) 및 wiki 기반 RAG
- Jira 티켓 자동 댓글 (담당자용 요약)
- 시스템 트레이 상주, 자동 업데이트
