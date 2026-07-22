// Mock Jira server — the minimal subset of Jira REST v2 that modules/jira/ uses
// (API.md §4), plus demo triggers. Replaces mock/ci-server.mjs as the issue source.
// Usage: npm run mock:jira  (port 8792)
import { createServer } from 'node:http'

const PORT = 8792
const PROJECT = 'CIOPS'
const BROWSE_BASE = `http://localhost:${PORT}/browse`

// Scenario pool mirrors mock/ci-server.mjs. The description encodes the fields the
// poller normalizes into a CIEvent — this is the dev contract until the real ticket
// schema is confirmed (TODO(SVP-6)).
const SCENARIOS = {
  'auth-token-401': {
    type: 'test_failed',
    summary: 'LoginFlowTest.test_token_refresh 실패 (401 Unauthorized)',
    module: 'auth',
    branch: 'feature/auth-refresh',
    log: 'AssertionError: expected status 200 but got 401\n  at LoginFlowTest.test_token_refresh (auth/tests/login_flow.py:88)'
  },
  'payment-build': {
    type: 'build_failed',
    summary: 'payment-service 빌드 실패: BillingClient::retry 심볼 누락',
    module: 'payment',
    branch: 'main',
    log: "ld.lld: error: undefined symbol: BillingClient::retry()\n>>> referenced by checkout.cc:412"
  },
  'snapshot-diff': {
    type: 'test_failed',
    summary: 'SnapshotTest.ui_diff 스냅샷 불일치',
    module: 'renderer-core',
    branch: 'feature/dark-mode',
    log: 'Snapshot mismatch: 3 pixels differ (threshold 0)\n  at SnapshotTest.ui_diff (ui/tests/snapshot.spec.ts:41)'
  },
  'auth-lint': {
    type: 'lint_failed',
    summary: 'eslint: no-floating-promises 위반 (auth/session.ts)',
    module: 'auth',
    branch: 'feature/session-cleanup',
    log: 'auth/session.ts:57:3  error  Promises must be awaited  @typescript-eslint/no-floating-promises'
  },
  'payment-e2e': {
    type: 'test_failed',
    summary: 'CheckoutE2E.test_refund_flow 타임아웃 (30s)',
    module: 'payment',
    branch: 'release/2.4',
    log: 'TimeoutError: waiting for selector "#refund-done" failed: timeout 30000ms exceeded'
  },
  'infra-deploy': {
    type: 'deploy_failed',
    summary: 'staging 배포 실패: helm upgrade 타임아웃',
    module: 'infra',
    branch: 'main',
    log: 'Error: UPGRADE FAILED: timed out waiting for the condition (release: svp-staging)'
  }
}

const STATUS = {
  Open: 'new',
  'In Progress': 'indeterminate',
  Done: 'done'
}
const TRANSITIONS = Object.keys(STATUS).map((name, i) => ({ id: String(i + 1), name }))

/** @type {Map<string, any>} key → internal ticket */
const tickets = new Map()
let seq = 1000

function createTicket(scenarioId) {
  const s = SCENARIOS[scenarioId]
  if (!s) return null
  seq += 1
  const key = `${PROJECT}-${seq}`
  const now = new Date().toISOString()
  const ticket = {
    key,
    summary: s.summary,
    description: [
      `type: ${s.type}`,
      `module: ${s.module}`,
      `branch: ${s.branch}`,
      `ci-url: https://ci.example.internal/builds/${seq}`,
      'log:',
      s.log
    ].join('\n'),
    labels: ['ci-failure'],
    status: 'Open',
    created: now,
    updated: now,
    // Mirrors 사내 운용: CI가 만든 티켓은 bot 계정에 배정된 채 시작한다.
    assignee: 'cicd_ap',
    comments: []
  }
  tickets.set(key, ticket)
  console.log(`[mock-jira] created ${key} (${scenarioId}): ${s.summary}`)
  return ticket
}

function touch(ticket) {
  ticket.updated = new Date().toISOString()
}

function toApi(t) {
  return {
    key: t.key,
    fields: {
      summary: t.summary,
      description: t.description,
      labels: t.labels,
      created: t.created,
      updated: t.updated,
      assignee: t.assignee ? { name: t.assignee } : null,
      status: { name: t.status, statusCategory: { key: STATUS[t.status] } },
      comment: { comments: t.comments }
    }
  }
}

// The mock only interprets created/updated bounds and "key in (...)" from JQL.
function searchByJql(jql) {
  const created = jql.match(/created\s*>=\s*"([^"]+)"/)
  const updated = jql.match(/updated\s*>=\s*"([^"]+)"/)
  const keys = jql.match(/key\s+in\s*\(([^)]+)\)/)
  const parseTs = (m) => (m ? Date.parse(m[1].replace(' ', 'T')) : null)
  const createdAfter = parseTs(created)
  const updatedAfter = parseTs(updated)
  const keySet = keys ? new Set(keys[1].split(',').map((k) => k.trim().replace(/["']/g, ''))) : null
  return [...tickets.values()].filter(
    (t) =>
      (keySet === null || keySet.has(t.key)) &&
      (createdAfter === null || Date.parse(t.created) >= createdAfter) &&
      (updatedAfter === null || Date.parse(t.updated) >= updatedAfter)
  )
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
  })
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const issueMatch = url.pathname.match(/^\/rest\/api\/2\/issue\/([^/]+)(\/(comment|assignee|transitions))?$/)

  if (req.method === 'GET' && url.pathname === '/rest/api/2/search') {
    const found = searchByJql(url.searchParams.get('jql') ?? '')
    return send(res, 200, { total: found.length, issues: found.map(toApi) })
  }

  if (issueMatch) {
    const ticket = tickets.get(issueMatch[1])
    if (!ticket) return send(res, 404, { errorMessages: [`issue ${issueMatch[1]} not found`] })
    const sub = issueMatch[3]

    if (req.method === 'GET' && !sub) return send(res, 200, toApi(ticket))
    if (req.method === 'GET' && sub === 'transitions') return send(res, 200, { transitions: TRANSITIONS })
    if (req.method === 'POST' && sub === 'comment') {
      const body = await readBody(req)
      ticket.comments.push({ body: body.body ?? '', created: new Date().toISOString() })
      touch(ticket)
      console.log(`[mock-jira] comment on ${ticket.key}`)
      return send(res, 201, ticket.comments.at(-1))
    }
    if (req.method === 'PUT' && sub === 'assignee') {
      const body = await readBody(req)
      ticket.assignee = body.name ?? null
      touch(ticket)
      console.log(`[mock-jira] assignee of ${ticket.key} → ${ticket.assignee}`)
      return send(res, 204, {})
    }
    if (req.method === 'POST' && sub === 'transitions') {
      const body = await readBody(req)
      const target = TRANSITIONS.find((t) => t.id === body.transition?.id)
      if (!target) return send(res, 400, { errorMessages: ['unknown transition id'] })
      ticket.status = target.name
      touch(ticket)
      console.log(`[mock-jira] ${ticket.key} → ${ticket.status}`)
      return send(res, 204, {})
    }
  }

  if (req.method === 'POST' && url.pathname === '/demo/trigger') {
    const { scenario, labels } = await readBody(req)
    const ticket = createTicket(scenario)
    if (!ticket) return send(res, 400, { error: `unknown scenario. one of: ${Object.keys(SCENARIOS).join(', ')}` })
    if (Array.isArray(labels)) ticket.labels.push(...labels) // e.g. svp-test (write-mode=label 검증용)
    return send(res, 201, toApi(ticket))
  }

  if (req.method === 'POST' && url.pathname === '/demo/resolve') {
    const { key, comment } = await readBody(req)
    const ticket = tickets.get(key)
    if (!ticket) return send(res, 404, { error: `ticket ${key} not found` })
    ticket.comments.push({ body: comment ?? '', created: new Date().toISOString() })
    ticket.status = 'Done'
    touch(ticket)
    console.log(`[mock-jira] resolved ${key}: ${comment}`)
    return send(res, 200, toApi(ticket))
  }

  if (req.method === 'GET' && url.pathname === '/demo/tickets') {
    return send(res, 200, [...tickets.values()])
  }

  send(res, 404, { error: 'not found' })
})

// Seed tickets so the poller has something to pick up right after start.
for (const scenarioId of ['auth-token-401', 'payment-build', 'snapshot-diff']) createTicket(scenarioId)

server.listen(PORT, () => {
  console.log(`[mock-jira] listening on http://localhost:${PORT} (browse: ${BROWSE_BASE}/<KEY>)`)
  console.log(`[mock-jira] trigger: curl -X POST localhost:${PORT}/demo/trigger -d '{"scenario":"auth-token-401"}'`)
})
