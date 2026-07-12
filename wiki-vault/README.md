# LLM-WIKI (SVP wiki-vault)

Andrej Karpathy의 llm-wiki 컨셉을 따르는 팀 지식 베이스.
**1차 독자는 사람이 아니라 LLM이다.** Sheriff Avatar의 classifier가 이슈를 분류할 때
이 vault를 검색해 신뢰도 점수의 근거로 사용한다.

## 작성 규칙

- 노트 하나 = 주제 하나. 파일명은 kebab-case.
- 애매한 표현 금지. 명시적 사실 / 재현 조건 / 담당자 / 해결 절차를 쓴다.
- 모듈별 known-failure는 `modules/`, 절차는 `playbooks/`에 둔다.
- `case-log.md`는 앱이 자동으로 append한다 (수동 편집은 Obsidian으로).
- 이 폴더는 Obsidian vault로 바로 열 수 있다.
