# 실측 산출물 (dry-run measurement artifacts)

ROI.md·발표 덱이 인용하는 실측 수치("자동 배정률 75%, 팀 정확도 70%" 등)의 **집계 산출물**.
주장을 제3자가 대조할 수 있도록 repo에 남긴다.

- **`replay-summary-2026-08-06-owner-refresh.json` — 3차 (담당자 목록 현행화 후).** 2차와 쌍으로 인용:
  **정비 전 57% → 정비 후 82%** (팀 정확도, 동일 예측 재채점).
- **`replay-summary-2026-08-06.json` — 2차 측정 (n=51, 정비 전 기준선).**
- `replay-summary-2026-08-05.json` — 1차 측정 (n=20) + before/after 실험 기록. 기록 보존용.

수치 블록은 `server/replay.mjs score --json`의 출력 스키마이고, `context` 등 해석 필드는
측정 기록에서 전사했다. 1차 → 2차에서 팀 정확도가 70%→57%로 내려간 이유는 2차 파일의
`context.vsFirstRun` 참고 — 상한(vault 커버리지)이 함께 내려갔고 상한 대비 성취율(~87%)과
게이트 정밀도(~71%)는 유지됐다.

## 왜 집계만 있나

원자료(`server/replay-data/` — 티켓 원문·Jenkins 로그·해결자 실명 truth CSV)는 사내 데이터라
repo에 커밋하지 않는다(gitignore, CLAUDE.md 절대 규칙 4). 반출 가능한 것은 **티켓 키·실명이
포함되지 않은 집계 수치**뿐이며, 이 디렉터리가 그 반출본이다.

## 재현 방법

사내 환경(Jira 접근 + Bedrock 자격증명)에서:

```bash
# 1. 해결 완료 티켓 수집 (read-only) → 2. 분류 재생 → 3. 채점
node server/replay.mjs collect --jql "<JQL> AND resolution = Done" --max 200
node server/replay.mjs run
SVP_LLM_CONFIDENCE_MIN=80 node server/replay.mjs score --truth <truth.csv> --json > docs/measurement/replay-summary-<날짜>.json
```

측정 설계(ground truth 격리·시간순 샘플링·before/after 프로토콜)는 `server/replay.mjs` 헤더
주석과 PR #66 참고.

## 한계 (스스로 기록)

- 재현 환경(실 티켓 복제본) 측정 — 실 시스템 직결 백테스트가 아니다. 티켓 내용·로그는 실데이터.
- before/after는 재발쌍 부족(1/10)으로 축적 효과를 검출하지 못했다 — 산출물에 그대로 남겼다.
- 1차(n=20)의 수치는 표본 확대에서 예고했던 대로(±10%p) 움직였다 — 2차(n=51)를 인용 기준으로 삼는다.
