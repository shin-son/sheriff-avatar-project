// Mock 사내 CI/CD 서버 — 주기적으로 CI 이슈 이벤트를 WebSocket으로 브로드캐스트한다.
// 사용: npm run mock:ci  (포트 8790, 앱의 기본 접속 대상)
import { WebSocketServer } from 'ws'

const PORT = 8790
const INTERVAL_MS = 12000

const POOL = [
  {
    type: 'test_failed',
    title: 'LoginFlowTest.test_token_refresh 실패 (401 Unauthorized)',
    module: 'auth',
    branch: 'feature/auth-refresh',
    log: 'AssertionError: expected status 200 but got 401\n  at LoginFlowTest.test_token_refresh (auth/tests/login_flow.py:88)'
  },
  {
    type: 'build_failed',
    title: 'payment-service 빌드 실패: BillingClient::retry 심볼 누락',
    module: 'payment',
    branch: 'main',
    log: "ld.lld: error: undefined symbol: BillingClient::retry()\n>>> referenced by checkout.cc:412"
  },
  {
    type: 'test_failed',
    title: 'SnapshotTest.ui_diff 스냅샷 불일치',
    module: 'renderer-core',
    branch: 'feature/dark-mode',
    log: 'Snapshot mismatch: 3 pixels differ (threshold 0)\n  at SnapshotTest.ui_diff (ui/tests/snapshot.spec.ts:41)'
  },
  {
    type: 'lint_failed',
    title: 'eslint: no-floating-promises 위반 (auth/session.ts)',
    module: 'auth',
    branch: 'feature/session-cleanup',
    log: 'auth/session.ts:57:3  error  Promises must be awaited  @typescript-eslint/no-floating-promises'
  },
  {
    type: 'test_failed',
    title: 'CheckoutE2E.test_refund_flow 타임아웃 (30s)',
    module: 'payment',
    branch: 'release/2.4',
    log: 'TimeoutError: waiting for selector "#refund-done" failed: timeout 30000ms exceeded'
  },
  {
    type: 'deploy_failed',
    title: 'staging 배포 실패: helm upgrade 타임아웃',
    module: 'infra',
    branch: 'main',
    log: 'Error: UPGRADE FAILED: timed out waiting for the condition (release: svp-staging)'
  }
]

let seq = 0

function nextEvent() {
  const base = POOL[seq % POOL.length]
  seq += 1
  return {
    ...base,
    id: `ci-${Date.now()}-${seq}`,
    url: `https://ci.example.internal/builds/${1000 + seq}`,
    timestamp: new Date().toISOString()
  }
}

const wss = new WebSocketServer({ port: PORT })
console.log(`[mock-ci] listening on ws://localhost:${PORT}`)
console.log(`[mock-ci] broadcasting one issue every ${INTERVAL_MS / 1000}s`)

wss.on('connection', (ws) => {
  console.log('[mock-ci] client connected')
  setTimeout(() => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(nextEvent()))
  }, 2000)
})

setInterval(() => {
  if (wss.clients.size === 0) return
  const event = nextEvent()
  console.log(`[mock-ci] → ${event.type} / ${event.module}: ${event.title}`)
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(JSON.stringify(event))
  }
}, INTERVAL_MS)
