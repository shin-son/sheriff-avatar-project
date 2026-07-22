// Mock Jira server — the minimal subset of Jira REST v2 that modules/jira/ uses
// (API.md §4), plus demo triggers. Replaces mock/ci-server.mjs as the issue source.
// Usage: npm run mock:jira  (port 8792)
import { createServer } from 'node:http'

const PORT = 8792
const PROJECT = 'CIOPS'
const BROWSE_BASE = `http://localhost:${PORT}/browse`

// Scenario pool. The description mirrors the REAL corporate ticket format
// (SVP-6, hosts anonymized): ` : `-separated key-value lines, NO failure log —
// the log lives in the linked Jenkins build (mock/jenkins-server.mjs TAILS,
// keyed by `module`). `type` drives the Step field; `tc` is the TC name.
const SCENARIOS = {
  'auth-token-401': { type: 'test_failed', module: 'auth', tc: 'linux.auth-token-refresh-088.sh' },
  'payment-build': { type: 'build_failed', module: 'payment', tc: 'payment/checkout.cc' },
  // python. 접두사 + 콘솔 마커의 I- 접두사 조합 (사내 실측 변형) 검증용
  'snapshot-diff': { type: 'test_failed', module: 'renderer-core', tc: 'python.ui-snapshot-diff-041.py' },
  'auth-lint': { type: 'lint_failed', module: 'auth', tc: 'linux.auth-session-lint-057.sh' },
  'payment-e2e': { type: 'test_failed', module: 'payment', tc: 'linux.payment-refund-e2e-030.sh' },
  'infra-deploy': { type: 'deploy_failed', module: 'infra', tc: 'linux.infra-staging-deploy-005.sh' }
}
const STEP_BY_TYPE = {
  test_failed: 'TEST',
  build_failed: 'BUILD',
  deploy_failed: 'DEPLOY',
  lint_failed: 'LINT'
}
const PLATFORM = 'idcevo_mock_100'

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
  const headline = `[DEV_CICD][${PLATFORM}][T${seq}] : ${s.tc} Failed`
  const cicdUrl = `https://cicd.example.internal:1234/detail?type=test-pipeline&seq=${seq}&platform_version=${PLATFORM.toUpperCase()}`
  const testUrl = `http://localhost:8794/job/ci-${s.module}/${seq}`
  const ticket = {
    key,
    summary: headline,
    // 실티켓 description은 줄바꿈 없는 HTML 한 덩어리로 온다 (사내 실측) —
    // 서버 htmlToText가 이를 줄 단위 계약으로 되돌리는 경로를 항상 검증한다.
    description:
      `<h2>${headline}</h2><ul>` +
      `<li>CICD Project : ${PLATFORM}</li>` +
      `<li>Step : ${STEP_BY_TYPE[s.type]}</li>` +
      `<li>Category : SPECIAL</li>` +
      `<li>TC name or file : ${s.tc}</li></ul>` +
      `<h2>Link</h2><ul>` +
      `<li>CICD : <a href='${cicdUrl}'>${cicdUrl}</a></li>` +
      `<li>TEST : <a href='${testUrl}'>${testUrl}</a></li>` +
      `<li>IMAGE DIR : None</li>` +
      `<li>DUMP DIR : None</li></ul>`,
    labels: ['ci-failure'],
    status: 'Open',
    created: now,
    updated: now,
    // Mirrors 사내 운용: CI가 만든 티켓은 bot 계정에 배정된 채 시작한다.
    assignee: 'cicd_ap',
    comments: []
  }
  tickets.set(key, ticket)
  console.log(`[mock-jira] created ${key} (${scenarioId}): ${s.tc} Failed`)
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
