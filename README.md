# Sheriff aVatar Project (SVP)

LLM-WIKI 기반 Sheriff Agent — CI/CD 이슈를 WebSocket으로 수신해 LLM이 분류하고,
신뢰도 점수에 따라 Feature 담당자 또는 Sheriff(당번)에게 배정하는 Windows 데스크톱 앱.

## 요구 사항

- Node.js 20+ / npm
- Windows 10/11

## 시작하기

```bash
npm install

# 터미널 1: mock CI/CD 서버 (ws://localhost:8790)
npm run mock:ci

# 터미널 2: 앱 개발 모드
npm run dev
```

mock 서버가 주기적으로 CI 이슈 이벤트를 보내면, 앱이 분류·배정 후
화면 우하단에 팝업 알림을 띄운다. 앱 사이드바에서 사용자(A/B/C)를 전환하며
"일반 팀원은 자기 이슈만 / 당번은 전체 이슈" 동작을 확인할 수 있다.

실제 CI/CD 서버 주소는 환경변수로 지정한다:

```bash
set SVP_CI_WS_URL=wss://ci.example.com/events
```

## EXE 인스톨러 빌드

```bash
npm run dist
# → dist/Sheriff Avatar Setup 0.1.0.exe
```

## 운영 원칙 (사내/사외)

- 이 repo(사외 GitHub)가 **유일한 개발 저장소**다. 모든 코드 작성은 사외에서 한다.
- 사내망에서는 `git pull`만 수행해 테스트한다. **사내 → 사외 push는 절대 금지.**
- 사내 테스트에서 에러 발견 → 에러 내용(민감정보 제거)을 사외로 전달 → 사외에서 수정 → 사내에서 다시 pull.

## 문서

- [CLAUDE.md](./CLAUDE.md) — 개발 규칙, 커밋 규칙, 모듈 맵 (Claude 사용 시 필독)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — 데이터 흐름과 모듈 설계
- [wiki-vault/](./wiki-vault/) — LLM-WIKI (Obsidian으로 열 수 있음)
