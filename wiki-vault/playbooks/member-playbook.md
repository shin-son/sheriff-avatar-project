---
type: playbook
role: member
updated: 2026-07-15
---

# 팀원(담당자) Playbook

일반 팀원은 자기에게 배정된 이슈만 본다. wiki를 똑똑하게 만드는 입력의 절반은 담당자의 피드백이다.

## 절차

1. 팝업/대시보드에서 배정 이슈 확인 → `확인` 버튼으로 acknowledge.
2. 분류 요약과 참조 노트(wikiRefs)를 열람하고, 노트의 fix 절차를 먼저 시도한다.
3. **참조 노트마다 👍/👎를 반드시 누른다.** 👎가 누적된 노트는 query에서 감점되고
   lint 정리 후보가 된다 — 이 피드백이 wiki 품질 루프의 입력이다.
4. 해결 완료 처리(현재: 앱의 `해결 완료` 버튼, F7 이후: Jira 티켓 Done 감지)
   → case-log.md에 자동 ingest 된다.
5. 참조 노트에 없던 새로운 실패 패턴이었다면 `modules/<모듈>.md`에 known-failure를
   추가한다 (템플릿: [README.md](../README.md)). F7 전까지는 직접 PR을 올리고,
   F7 이후에는 앱이 만든 LLM 초안 PR을 리뷰·수정만 하면 된다.
   이 기록이 다음 분류의 신뢰도를 올린다.
6. 잘못 배정된 이슈면 당번에게 재배정을 요청한다 ([sheriff-playbook.md](sheriff-playbook.md)).
