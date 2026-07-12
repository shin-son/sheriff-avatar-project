# CLAUDE.md — Sheriff aVatar Project (SVP)

> 이 문서는 "새로 합류한 엔지니어에게 주는 온보딩 문서"처럼 유지한다 (Andrej Karpathy 방식).
> 짧고, 사실만, 항상 최신으로. 코드와 어긋난 내용을 발견하면 **그 PR에서 같이 고친다.**
> 장황한 설명·희망사항·죽은 규칙은 넣지 않는다.

## 프로젝트 개요

LLM-WIKI 기반 Sheriff Agent Windows 데스크톱 앱 (Electron + React + TypeScript).

- 사내 CI/CD에서 이슈(TEST FAILED 등)가 발생하면 **WebSocket**으로 앱에 수신된다.
- LLM이 **LLM-WIKI**(`wiki-vault/`, Obsidian 호환 마크다운)를 참조해 이슈를 분류하고 **신뢰도 점수(0~100)** 를 매긴다.
- **신뢰도 > 80점** → 해당 FEATURE(ip) 담당자에게 배정. **80점 이하** → Sheriff(당번)에게 배정 (human-in-the-loop).
- 팀원 전원이 EXE로 앱을 설치한다. 일반 팀원은 **자기에게 배정된 이슈만**, 당번은 **모든 이슈**를 본다.
- 이슈 처리 결과는 다시 LLM-WIKI에 기록되어 다음 분류의 근거가 된다.

## 절대 규칙 (STOP — 위반 금지)

1. **요청이 애매하면 진행하지 말고 반드시 다시 물어본다.** 추측으로 구현하지 않는다.
2. **사내망에서는 이 repo를 pull만 한다.** 사내에서 작성·수정된 코드는 어떤 경우에도 이 repo로 push하지 않는다. 모든 코드 개발은 사외에서만 한다.
3. **최대한 모듈화한다.** 모듈 경계(아래 모듈 맵)를 넘는 변경은 커밋 전에 팀과 논의한다.
4. 비밀정보(API key, 사내 URL, 사내 로그)는 절대 커밋하지 않는다. `.env`는 gitignore 대상.

## Claude 작업 원칙 (Karpathy 가이드라인)

주의: 이 원칙들은 속도보다 신중함을 우선한다. 사소한 작업에는 판단껏 적용.

**코딩 전에 생각한다.**
- 가정을 명시적으로 밝힌다. 불확실하면 묻는다.
- 해석이 여러 개면 제시한다 — 조용히 하나를 고르지 않는다.
- 더 단순한 방법이 있으면 말한다. 필요하면 반박한다.

**단순함 우선.**
- 요청받지 않은 기능·추상화·"유연성"·설정 옵션을 추가하지 않는다.
- 일어날 수 없는 시나리오에 대한 에러 처리를 만들지 않는다.
- 200줄을 썼는데 50줄로 될 것 같으면 다시 쓴다. "시니어가 보면 과하다고 할까?" — 그렇다면 단순화.

**수술적 변경.**
- 요청과 무관한 인접 코드·주석·포맷을 "개선"하지 않는다. 기존 스타일을 따른다.
- 무관한 dead code를 발견하면 지우지 말고 언급만 한다 (삭제는 금요일 정리 PR에서만).
- 내 변경으로 생긴 고아(import/변수/함수)는 내가 지운다.
- 검증: 변경된 모든 줄이 요청으로 직접 소급되어야 한다.

**목표 주도 실행.**
- 작업을 검증 가능한 목표로 바꾼다: "버그 수정" → "재현 테스트 작성 후 통과시키기".
- 여러 단계 작업은 `단계 → 검증 방법` 형태의 짧은 계획을 먼저 제시한다.
- 최소 검증: 커밋 전 `npm run typecheck` + 해당 기능 수동 확인.

## 명령어

```bash
npm install          # 의존성 설치
npm run dev          # 개발 모드 실행 (HMR)
npm run mock:ci      # mock CI/CD WebSocket 서버 (별도 터미널, 포트 8790)
npm run typecheck    # 타입 체크
npm run build        # 프로덕션 빌드 (out/)
npm run dist         # Windows EXE 인스톨러 생성 (dist/)
```

로컬 개발은 항상 `mock:ci`를 먼저 띄우고 `dev`를 실행한다.

## 모듈 맵

```
src/main/                        Electron 메인 프로세스
  modules/websocket/             CI/CD WebSocket 수신 (재접속 포함)
  modules/classifier/            LLM 이슈 분류 + 신뢰도 점수 (현재 stub, TODO: Claude API)
  modules/wiki/                  LLM-WIKI 어댑터 (wiki-vault/ 읽기·케이스 로그 쓰기)
  modules/assignment/            신뢰도 기반 담당자 라우팅 (>80 → feature owner, ≤80 → sheriff)
  modules/notifications/         하단 팝업(toast) 알림 창 관리
src/preload/                     contextBridge API (window.svp)
src/renderer/                    React UI (index = 대시보드, toast = 팝업)
src/shared/                      main/renderer 공용 타입·팀 설정
wiki-vault/                      LLM-WIKI (Obsidian 호환 마크다운)
mock/                            mock CI/CD 서버
```

- 모듈 간 통신은 `src/shared/types.ts`의 타입으로만 한다. 모듈이 다른 모듈 내부 파일을 직접 import하지 않는다.
- renderer는 Node API를 쓰지 않는다. 모든 시스템 접근은 preload의 `window.svp`를 통한다.

## 코드 스타일

- TypeScript strict. `any` 금지 (불가피하면 이유를 주석으로).
- 함수·모듈은 작게. 파일이 200줄을 넘으면 분리를 검토한다.
- UI 문자열은 한국어, 코드 식별자·주석은 영어.
- 미구현 지점은 `// TODO(SVP-이슈번호):` 형식으로 남긴다.

## 커밋 규칙 (3인 공동 개발, Claude 사용)

- **Conventional Commits**: `type(scope): subject`
  - type: `feat` `fix` `refactor` `docs` `test` `chore` `build`
  - scope는 모듈명: `ws` `classifier` `wiki` `router` `toast` `ui` `main` `shared` `mock` `docs`
  - 예: `feat(classifier): add confidence scoring based on wiki match`
- 커밋 하나 = 논리적 변경 하나. 리팩토링과 기능 추가를 한 커밋에 섞지 않는다.
- subject는 72자 이내, 명령형. body에는 **왜** 바꿨는지를 쓴다.
- **main 브랜치 직접 push 금지.** 브랜치(`feat/<scope>-<desc>`, `fix/<scope>-<desc>`)에서 작업 → PR → 다른 1인 리뷰 승인 후 merge.
- Claude가 생성한 커밋은 `Co-Authored-By: Claude <noreply@anthropic.com>` trailer를 유지한다.
- 커밋 전 `npm run typecheck`가 통과해야 한다.

## 리뷰 프로세스 & 코드 위생

- **자기(또는 Claude)가 쓴 코드는 PR 올리기 전에 스스로 전체 diff를 검토한다.** Claude가 생성한 코드도 예외 없음 — 이해하지 못한 코드는 merge하지 않는다.
- 모든 PR은 다른 1인의 리뷰 승인 후 merge. 순환 리뷰: A→B→C→A ([docs/PLAN.md](./docs/PLAN.md) 참고).
- **동작이 확인되면 그 시점을 즉시 작은 커밋으로 남긴다.** "잘 되는 상태"가 커밋 히스토리에 항상 존재해야 하며, 되돌아갈 지점 없이 큰 변경을 쌓지 않는다.
- **커밋 규칙(위 섹션)은 반드시 지킨다.** 규칙 위반 커밋은 리뷰에서 reject하고 다시 쓴다.
- **쓸데없는 코드는 주기적으로 제거한다.** 매주 금요일 dead code / 미사용 export / 주석 처리된 코드 정리 (`chore(scope): remove dead code`). 기능 삭제가 아니라 위생 정리임을 커밋 메시지에 명시.
- **폴더 구조는 리팩토링이 쉽고 가독성이 좋게 유지한다.** 현재 모듈 맵 구조를 기준으로 하고, 구조 변경(파일 이동/이름 변경)은 기능 변경과 섞지 말고 단독 PR로 분리한다.

## 일정

구현 완료 기한 **2026-08-01**. 주차별 모듈 분배와 마일스톤은 [docs/PLAN.md](./docs/PLAN.md).

## LLM-WIKI 규칙 (`wiki-vault/`)

- Karpathy의 llm-wiki 컨셉을 따른다 (원문: [docs/llm-wiki-concept.md](./docs/llm-wiki-concept.md)): **1차 독자는 사람이 아니라 LLM이다.** 애매한 표현 대신 명시적 사실·조건·담당자를 쓴다.
- 3계층 매핑 — raw sources: CI 로그/이슈 이벤트(불변), wiki: `wiki-vault/`(LLM이 작성·유지), schema: 이 섹션.
- 노트 하나 = 주제 하나 (모듈별 known-failure, playbook, case-log).
- 이슈 처리 완료 시 앱이 `wiki-vault/case-log.md`에 케이스를 append한다. 수동 편집은 Obsidian으로 한다.
- wiki 내용 변경도 코드와 동일하게 PR 리뷰를 거친다.
