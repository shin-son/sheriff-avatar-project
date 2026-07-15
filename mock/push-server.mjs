// Mock 중앙 서버 push — Jira 업데이트(처리 완료된 SheriffIssue)를 Socket.IO로 push한다.
// 임시 계약: issue:new / issue:updated 이벤트에 SheriffIssue payload (src/main/modules/push/socketio.ts 참고).
// 사용: npm run mock:push  (포트 8793, 앱의 기본 접속 대상)
import { Server } from 'socket.io'

const PORT = 8793
const NEW_INTERVAL_MS = 15000
const UPDATE_DELAY_MS = 7000

const POOL = [
  {
    event: {
      type: 'test_failed',
      title: 'LoginFlowTest.test_token_refresh 실패 (401 Unauthorized)',
      module: 'auth',
      branch: 'feature/auth-refresh',
      log: 'AssertionError: expected status 200 but got 401\n  at LoginFlowTest.test_token_refresh (auth/tests/login_flow.py:88)'
    },
    classification: {
      category: 'auth-test-failure',
      severity: 'major',
      confidence: 88,
      summary: '토큰 갱신 시 401 — auth 모듈 회귀로 추정'
    },
    assignment: {
      assigneeId: 'alice',
      assigneeName: 'Alice (A)',
      routedTo: 'feature-owner',
      reason: 'confidence 88 > 80 → auth owner'
    }
  },
  {
    event: {
      type: 'build_failed',
      title: 'payment-service 빌드 실패: BillingClient::retry 심볼 누락',
      module: 'payment',
      branch: 'main',
      log: 'ld.lld: error: undefined symbol: BillingClient::retry()\n>>> referenced by checkout.cc:412'
    },
    classification: {
      category: 'build-failure',
      severity: 'critical',
      confidence: 92,
      summary: '링크 에러 — payment 모듈 최근 커밋 원인'
    },
    assignment: {
      assigneeId: 'bob',
      assigneeName: 'Bob (B)',
      routedTo: 'feature-owner',
      reason: 'confidence 92 > 80 → payment owner'
    }
  },
  {
    event: {
      type: 'deploy_failed',
      title: 'staging 배포 실패: helm upgrade 타임아웃',
      module: 'infra',
      branch: 'main',
      log: 'Error: UPGRADE FAILED: timed out waiting for the condition (release: svp-staging)'
    },
    classification: {
      category: 'deploy-failure',
      severity: 'major',
      confidence: 55,
      summary: '원인 불명 배포 실패 — 수동 확인 필요'
    },
    assignment: {
      assigneeId: 'carol',
      assigneeName: 'Carol (C)',
      routedTo: 'sheriff',
      reason: 'confidence 55 ≤ 80 → sheriff'
    }
  }
]

let seq = 0

function nextIssue() {
  const base = POOL[seq % POOL.length]
  seq += 1
  const key = `CIOPS-${100 + seq}`
  const url = `https://jira.example.internal/browse/${key}`
  return {
    event: {
      ...base.event,
      id: `push-${Date.now()}-${seq}`,
      url,
      timestamp: new Date().toISOString(),
      source: 'jira',
      jira: { key, url, status: 'new' }
    },
    classification: { ...base.classification, wikiRefs: [] },
    assignment: base.assignment,
    status: 'new',
    receivedAt: new Date().toISOString()
  }
}

const io = new Server(PORT)
console.log(`[mock-push] listening on http://localhost:${PORT}`)
console.log(`[mock-push] pushing issue:new every ${NEW_INTERVAL_MS / 1000}s (+ issue:updated after ${UPDATE_DELAY_MS / 1000}s)`)

function pushOne() {
  const issue = nextIssue()
  console.log(`[mock-push] → issue:new ${issue.event.jira.key} → ${issue.assignment.assigneeId}: ${issue.event.title}`)
  io.emit('issue:new', issue)
  // 같은 이슈의 Jira 상태 변경을 뒤이어 push해 update 렌더링을 확인한다.
  setTimeout(() => {
    const updated = {
      ...issue,
      status: 'acknowledged',
      event: { ...issue.event, jira: { ...issue.event.jira, status: 'indeterminate' } }
    }
    console.log(`[mock-push] → issue:updated ${issue.event.jira.key} (status: acknowledged)`)
    io.emit('issue:updated', updated)
  }, UPDATE_DELAY_MS)
}

io.on('connection', (socket) => {
  const clientId = socket.handshake.auth?.clientId ?? '<unknown>'
  console.log(`[mock-push] client connected: ${clientId}`)
  setTimeout(pushOne, 2000)
  socket.on('disconnect', () => console.log(`[mock-push] client disconnected: ${clientId}`))
})

setInterval(() => {
  if (io.engine.clientsCount === 0) return
  pushOne()
}, NEW_INTERVAL_MS)
