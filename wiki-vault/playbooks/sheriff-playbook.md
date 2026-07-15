---
type: playbook
role: sheriff
updated: 2026-07-15
---

# Sheriff(당번) Playbook

당번은 신뢰도 80점 이하로 분류된 이슈의 1차 판단자다 (human-in-the-loop).

## 절차

1. 앱 팝업/피드에서 이슈 확인 → `확인` 버튼으로 acknowledge.
2. CI 로그와 wiki의 관련 노트를 대조해 실제 모듈을 판단한다.
3. 판단 결과:
   - 특정 모듈 이슈가 확실 → 해당 owner에게 전달 (추후: 앱에서 재배정 기능)
   - 인프라/일시적 이슈 → 재시도 후 종결
4. 처리 완료 시 `해결 완료` 버튼 → case-log.md에 자동 기록된다.
5. 새로운 실패 패턴이면 `modules/<모듈>.md`에 known-failure로 추가한다.
   이 기록이 다음 분류의 신뢰도를 올린다 (llm-wiki 루프).

## 주기 점검 (wiki 유지보수)

당번은 wiki 품질의 최종 책임자다. 주 1회(금요일 정리와 함께):

1. 대시보드의 `WIKI 점검` 버튼으로 lint를 실행한다.
2. 고아 노트 → 관련 노트에서 링크를 추가하거나 다른 노트에 통합한다.
3. 부정 피드백 누적(👎 3회 이상) 노트 → 내용을 재검토해 수정 또는 삭제 PR을 올린다.
4. F8 이후 lint가 추가 보고하는 항목도 처리한다: 노트 간 모순, case-log와 어긋나는
   낡은 fix 절차, 반복되는데 known-failure로 승격 안 된 case-log 패턴.
5. wiki 변경은 코드와 동일하게 PR 리뷰를 거친다 (템플릿·규칙: [README.md](../README.md)).

일반 팀원의 절차는 [member-playbook.md](member-playbook.md).
