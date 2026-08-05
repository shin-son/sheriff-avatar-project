# SVP 데모 영상 시나리오 (최종본 기준)

> **2026-08-05 갱신**: 데모 영상은 **제작 완료**됐다. 이 문서는 최종 영상의 구성과 촬영 설정을
> 기록한다 (재촬영·컷 교체 시 이 문서 기준). 내레이션 대본의 단일 원본은 사외 자산
> `svp-demo-assets/tts/narration-script.txt` (TTS: ElevenLabs Xavier, repo 밖 관리).
>
> **데모에 등장하는 모든 기능은 100% 구현된 실제 동작이다.** 연출된 목업 화면은 없다 —
> 티켓 수집·분류·자동 배정·분석 코멘트·담당자 후보 추천·해결 감지·위키 ingest·피드백 감점·
> lint 정리 후보까지 전부 실제 서버(`server/`)와 앱이 수행하는 장면을 녹화했다.

## 영상 전체 구성

| 순서 | 섹션 | 화면 | 제작 방식 |
|---|---|---|---|
| 1 | 서부극 컨셉 릴 (~55초) | ep1~3 + 로고 스팅 | 생성 영상 (완성: `full_reel_final_v4`) |
| 2 | 오프닝 (~13초) | 치비 보안관 캐릭터 + 로고, 인사 (opening_01) | 생성 영상 + TTS 더빙 (`opening_v5_final_4k`) |
| 3 | 문제 제기 (~12초) | 티켓→화살표→담당자❓ 장표 (opening_02) + "큰 그림" 브리지 (opening_03) | `docs/demo/opening-problem-slide.html` 사내 Cap 녹화 |
| 4 | 다이어그램 설명 (~59초) | 루프 다이어그램 1장, 줌 인/아웃 (intro_01~09) | 사외 제작 + TTS |
| 5 | 실전 데모 (~2분) | 사내 실데이터 시연 (demo_01~06, 아래 상세) | **사내 Cap 녹화** + TTS |
| 6 | 클로징 비전 (~22초) | MVP 사이클→로드맵→진짜 AVATAR 장표 (outro_01) | `docs/demo/closing-vision-slide.html` 사내 Cap 녹화 |
| 7 | 굿바이 (~23초) | 캐릭터가 장표를 밀어내고 등장→클로징 대사→인사 (outro_02) | 생성 영상 + TTS 더빙 (`outro_full_4k_final`) |

## 실전 데모 파트 — 내레이션 블록 ↔ 화면 매핑

사내 실데이터로 촬영: **실제 프로젝트에서 진행 중인 티켓 30건을 복제**해 서버가 수집·분류.
당번 앱과 담당자(shin.son) 앱을 **두 창으로 나란히** 띄워두고 진행한다.

| 블록 | 화면 | 보여주는 기능 |
|---|---|---|
| demo_01 | 당번 앱(전체 이슈) + 담당자 앱(자기 배정분만) 두 창 | 역할별 서버사이드 필터링 |
| demo_02 | 당번 대시보드의 티켓 30건 | 실데이터 수집 |
| demo_03 | 30건 중 26건 자동 배정 → 담당자 창에 유입 | LLM 분류 + >80 자동 배정 (`SVP_FORCE_ASSIGNEE`로 배정 대상을 발표자로 고정) |
| demo_03a | 미배정(≤80) 티켓의 담당자 후보 리스트 | 담당자 후보 추천 (Gerrit 기반) |
| demo_04 | 이슈 상세의 자동 분석 코멘트 | 위키 근거 분석 코멘트 |
| demo_05 | Jira에서 티켓 닫기 → 앱 자동 반영 → 위키 노트 피드백 | 해결 감지 + 피드백 |
| demo_05a1 | 앱의 모듈 분류 현황 | 모듈별 분류 집계 |
| demo_05a2 | **Linux 서버에서 `git diff`·`git status`·`git log`** 로 vault 변경 확인 | 해결 → 위키 자동 업데이트(ingest)의 증거 |
| demo_05a3 | 당번 앱의 위키 점검(lint) — 부정 피드백 누적 노트가 정리 후보로 | 피드백 감점 → lint 루프 (삭제는 사람이 결정) |
| demo_05a4 | (화면 유지) | 위키 신뢰 유지 메시지 |
| demo_05b | **Obsidian으로 wiki-vault 열람** — 모듈 중심 링크 구조 | 실제 위키 완성도 |
| demo_06 | Obsidian 그래프 뷰가 자라나는 모습 | 성장하는 시스템 (마무리) |

## 사내 촬영 설정

- main 브랜치 pull 후 실행. 장표 2종은 브라우저 F11 전체화면 → 클릭 진행
  (`opening-problem-slide.html` 4클릭, `closing-vision-slide.html` 6클릭 — 내레이션 타이밍에 맞춤).
- `.env`:
  - `SVP_JIRA_WRITE_MODE=live` (복제 티켓 전용 프로젝트라 실배정·코멘트·전이 허용)
  - `SVP_FORCE_ASSIGNEE=shin.son` — 자동 배정 대상을 발표자 계정으로 고정 (팀원 알림 방지, 담당자 창 시연용)
  - `SVP_INGEST_MODE=live` — 해결 시 vault 실기록 (demo_05a2의 git diff 컷 전제)
- 촬영 전 `server/issue-cache.json` 삭제 (분류가 실제로 도는 장면 확보),
  vault는 `git restore wiki-vault && git clean -fd wiki-vault`로 초기화.
- 녹화는 Cap 사용, 원본 소리 무음 (내레이션은 전부 후반 TTS).
- 마이크 불필요 — 컷별로 끊어 찍고 TTS 길이에 페이싱을 맞춘다 (블록별 길이는 narration-script.txt).

## 리허설에서 자주 터지는 것

- **자동 배정이 안 돈다** → `issue-cache.json`이 남아 분류가 스킵됨 (삭제 후 재시작), 또는 classifier off (LLM env 확인).
- **위키 git diff에 변화가 없다** → `SVP_INGEST_MODE=live` 누락.
- **팝업이 즉시 사라진다** → TTL 9초. 트리거 직후 커서로 팝업을 가리킬 것 (컷 재촬영 가능).
- **Obsidian이 갱신을 안 보여준다** → 편집 모드 포커스면 반영이 늦다. 읽기 모드로 열어둘 것.
- **데모 후 `git status`에 wiki-vault 변경이 남는다** → 커밋 금지, restore/clean으로 원복.
