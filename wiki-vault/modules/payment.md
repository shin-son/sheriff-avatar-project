---
type: module
module: payment
owner: bob
tags: [checkout, billing, refund]
updated: 2026-07-15
---

# payment 모듈

## Known failures

### BillingClient 링크 에러

- symptom: undefined symbol BillingClient::retry
- cause: billing 라이브러리 버전과 checkout 서비스 버전 불일치
- fix: billing lib을 lockfile 버전으로 고정 후 재빌드

### refund flow E2E 타임아웃

- symptom: CheckoutE2E.test_refund_flow 30s 타임아웃
- cause: staging PG(payment gateway) mock 응답 지연
- fix: PG mock 응답 시간 확인, 필요 시 재시도. 반복되면 Bob에게 에스컬레이션
