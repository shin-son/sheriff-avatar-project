# LLM-WIKI (SVP wiki-vault)

Andrej Karpathy의 llm-wiki 컨셉([원문 전문](../docs/llm-wiki-concept.md))을 따르는 팀 지식 베이스.
**1차 독자는 사람이 아니라 LLM이다.** Sheriff Avatar의 classifier가 이슈를 분류할 때
이 vault를 검색해 신뢰도 점수의 근거로 사용한다.

## 핵심 동작 (앱이 수행)

- **query** — 이슈 분류 시 관련 노트 검색 (classifier의 신뢰도 근거)
- **ingest** — 해결된 이슈를 `case-log.md`에 기록하고 `index.md`/`log.md` 갱신
- **lint** — 고아 노트, 부정 피드백 누적 노트 점검 (당번 대시보드의 "WIKI 점검" 버튼)
- **feedback** — 담당자가 참조 노트에 👍/👎. 부정 누적(👎 3회 이상) 노트는 query에서 감점되고 lint에서 정리 후보로 표시 — **쓸데없는 정보가 wiki를 오염시키지 않게 하는 루프**

## 특수 파일

- `index.md` — 콘텐츠 카탈로그 (자동 갱신, 수동 편집 금지)
- `log.md` — 시간순 append-only 작업 기록 (자동 갱신)
- `case-log.md` — 해결된 이슈 케이스 (앱이 append)

## 작성 규칙

- 노트 하나 = 주제 하나. 파일명은 kebab-case.
- 애매한 표현 금지. 명시적 사실 / 재현 조건 / 담당자 / 해결 절차를 쓴다.
- 모듈별 known-failure는 `modules/`, 절차는 `playbooks/`에 둔다.
- 이 폴더는 Obsidian vault로 바로 열 수 있다.
