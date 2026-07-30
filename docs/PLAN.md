# SVP 개발 계획 — 완료 기록 (2026-07-12 ~ 2026-08-01)

3인 공동 개발 (손신 / 김병재 / 김민석 — 당번 역할 겸 통합 책임).
모든 PR은 순환 리뷰(손신→김병재→김민석→손신) 승인 후 merge했다.

## 결과 요약

| 주차 | 목표 | 결과 |
|---|---|---|
| Week 1 (7/12~7/18) | 서버·클라이언트 분리 + Jira 폴링 유입 (F1, F6, 클라이언트 수신) | ✅ M1 달성 — mock Jira 기준 폴링→분류(stub)→배정→push→화면 표시 |
| Week 2 (7/19~7/25) | 핵심 지능 — LLM 실분류(F3), 수동 재배정(F4), 해결 감지→ingest(F7), feedback(F8) | ✅ M2 달성 — 실분류 + Jira write 3종 + ingest가 mock 시나리오로 검증 |
| Week 3 (7/26~8/1) | 통합 — 사내 Jira dry-run 검증, EXE 패키징, E2E 시나리오, 문서 정합화 | ✅ 7/30 코드 프리즈, 이후 fix/docs만 |

기능 번호(F1~)와 완료 기준·검증 방법은 [BACKEND.md](./BACKEND.md), 현행 구조는 [ARCHITECTURE.md](./ARCHITECTURE.md) 기준.

## 범위 제외 (v1 이후)

- 자동 업데이트(auto-updater)
- 멀티팀 지원
- 클라이언트 토큰 인증 (v1은 사내망 신뢰 기반)
- known-failure 승격 초안 PR 자동 생성 (ingest는 case-log까지 — [wiki-vault/README.md](../wiki-vault/README.md))
