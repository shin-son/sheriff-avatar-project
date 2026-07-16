---
type: module
module: infra
owner: carol
tags: [ci-runner, deploy, staging]
updated: 2026-07-15
---

# infra 모듈

## Known failures

### CI runner 네트워크 flaky

- symptom: ECONNRESET / ETIMEDOUT 이 서로 다른 테스트에서 산발적으로 발생, 재실행 시 통과
- cause: CI runner ↔ staging 간 네트워크 순단
- fix: 파이프라인 재시도. 같은 브랜치에서 2회 이상 반복되면 Carol에게 에스컬레이션
- confidence-hint: 특정 모듈 코드와 무관한 패턴 — feature owner 배정 대신 sheriff가 재시도 후 종결

### deploy registry 인증 실패

- symptom: deploy 단계에서 "denied: requested access to the resource is denied"
- cause: CI secret의 registry 인증 토큰 만료
- fix: registry 토큰 재발급 후 CI secret 갱신 (인프라 담당)
