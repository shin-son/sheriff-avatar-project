---
type: module
module: auth
owner: alice
tags: [login, session, token-refresh]
updated: 2026-07-15
---

# auth 모듈

## Known failures

### token refresh 401 (flaky)

- symptom: LoginFlowTest.test_token_refresh 가 간헐적으로 401을 반환
- cause: 테스트 환경의 token TTL(5s)이 CI 러너 지연보다 짧을 때 발생
- fix: 테스트 fixture에서 TTL을 60s로 늘리거나 mock clock 사용
- confidence-hint: 이 패턴이면 auth 담당자(Alice)에게 바로 배정 가능

### session cleanup lint

- no-floating-promises 위반은 대부분 session.ts의 fire-and-forget 정리 로직
- fix: `void` 연산자 또는 명시적 await
