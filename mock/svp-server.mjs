// v3 server prototype (docs/arch-v3-server-split demo) — a standalone headless
// pipeline: polls mock Jira (8792) → classify (stub) → route → Socket.IO push
// with SERVER-SIDE filtering (members get their own issues, sheriffs get all).
// Speaks the temporary push contract of modules/push/socketio.ts, so the app
// connects to it unchanged. Replaces mock/push-server.mjs for the full-cycle
// demo: run mock:jira first, then this, then the app.
// Usage: npm run mock:server  (port 8793)
import { Server } from 'socket.io'

const PORT = 8793
const JIRA = process.env.SVP_JIRA_BASE_URL ?? 'http://localhost:8792'
const POLL_MS = Number(process.env.SVP_SERVER_POLL_MS ?? 5000)

// Mirrors src/shared/team.ts (mock territory — the real server will own the roster).
const TEAM = [
  { id: 'alice', name: 'Alice (A)', role: 'member', ownedModules: ['auth', 'login'] },
  { id: 'bob', name: 'Bob (B)', role: 'member', ownedModules: ['payment', 'billing'] },
  { id: 'carol', name: 'Carol (C)', role: 'sheriff', ownedModules: ['infra'] }
]
const SHERIFF = TEAM.find((m) => m.role === 'sheriff')

const SEVERITY_BY_TYPE = {
  build_failed: 'critical',
  deploy_failed: 'critical',
  test_failed: 'major',
  lint_failed: 'minor'
}
const STATUS_BY_CATEGORY = { new: 'new', indeterminate: 'acknowledged', done: 'resolved' }

/** key → SheriffIssue (the server owns the issue store in v3). */
const issues = new Map()
let lastPoll = null

function hash(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// description contract: `key: value` header lines, then `log:` + raw log
// (same parsing as src/main/modules/jira/poller.ts normalizeTicket).
function normalize(t) {
  const lines = (t.fields.description ?? '').split('\n')
  const fields = {}
  let log = ''
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === 'log:') {
      log = lines.slice(i + 1).join('\n')
      break
    }
    const sep = lines[i].indexOf(': ')
    if (sep > 0) fields[lines[i].slice(0, sep)] = lines[i].slice(sep + 2)
  }
  return {
    id: t.key,
    type: fields['type'] ?? 'test_failed',
    title: t.fields.summary,
    module: fields['module'] ?? 'unknown',
    branch: fields['branch'] ?? '',
    log: log || (t.fields.description ?? ''),
    url: fields['ci-url'] ?? `${JIRA}/browse/${t.key}`,
    timestamp: t.fields.created,
    source: 'jira',
    jira: { key: t.key, url: `${JIRA}/browse/${t.key}`, status: t.fields.status.statusCategory.key }
  }
}

// Stub classify+route (mirrors the app's classifier stub shape; no wiki here).
function classifyAndRoute(event) {
  const owner = TEAM.find((m) => m.ownedModules.includes(event.module) && m.role === 'member')
  const confidence = owner ? Math.min(99, 84 + (hash(event.id) % 12)) : 40 + (hash(event.id) % 20)
  const assignee = confidence > 80 && owner ? owner : SHERIFF
  return {
    classification: {
      category: owner ? event.module : 'unknown',
      severity: SEVERITY_BY_TYPE[event.type] ?? 'major',
      confidence,
      summary:
        confidence > 80
          ? `'${event.module}' 모듈의 ${event.type} 이슈로 분류됨.`
          : '확실한 근거 부족 — 당번의 직접 확인이 필요함.',
      wikiRefs: []
    },
    assignment: {
      assigneeId: assignee.id,
      assigneeName: assignee.name,
      routedTo: assignee === SHERIFF && !(owner && confidence > 80) ? 'sheriff' : 'feature-owner',
      reason:
        confidence > 80 && owner
          ? `confidence ${confidence} > 80 → ${event.module} owner`
          : `confidence ${confidence} ≤ 80 → sheriff`
    }
  }
}

// ---- Socket.IO: one session per clientId, server-side filtering ----
const io = new Server(PORT)
const sessions = new Map() // clientId → socket

function recipientsOf(issue) {
  const ids = new Set(TEAM.filter((m) => m.role === 'sheriff').map((m) => m.id))
  ids.add(issue.assignment.assigneeId)
  return ids
}

function emitIssue(type, issue) {
  for (const id of recipientsOf(issue)) {
    sessions.get(id)?.emit(type, issue)
  }
  console.log(`[svp-server] → ${type} ${issue.event.jira.key} (${issue.status}) → ${[...recipientsOf(issue)].join(', ')}`)
}

io.on('connection', (socket) => {
  const clientId = String(socket.handshake.auth?.clientId ?? '')
  const member = TEAM.find((m) => m.id === clientId)
  if (!member) {
    console.log(`[svp-server] unknown client rejected: ${clientId}`)
    socket.disconnect(true)
    return
  }
  sessions.get(clientId)?.disconnect(true)
  sessions.set(clientId, socket)
  // Replay this client's visible unresolved issues (reconnect restore).
  const visible = [...issues.values()].filter(
    (i) => i.status !== 'resolved' && recipientsOf(i).has(clientId)
  )
  visible.forEach((i) => socket.emit('issue:new', i))
  console.log(`[svp-server] ${clientId} connected (${visible.length} issue(s) restored)`)

  // C→S (v3): the assignee checked the ticket — transition it in Jira.
  // Status flows back via polling, never written locally (Jira = source of truth).
  socket.on('issue:ack', async (payload) => {
    const issue = [...issues.values()].find((i) => i.event.id === payload?.issueId)
    if (!issue || issue.status !== 'new') return
    try {
      const url = `${JIRA}/rest/api/2/issue/${issue.event.jira.key}/transitions`
      const { transitions } = await (await fetch(url)).json()
      const target = transitions.find((t) => t.name === 'In Progress')
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transition: { id: target.id } })
      })
      console.log(`[svp-server] ack from ${clientId}: ${issue.event.jira.key} → In Progress`)
      void poll()
    } catch (err) {
      console.error(`[svp-server] ack transition failed: ${err.message}`)
    }
  })

  socket.on('disconnect', () => {
    if (sessions.get(clientId) === socket) sessions.delete(clientId)
    console.log(`[svp-server] ${clientId} disconnected`)
  })
})

// ---- Jira polling: new tickets + status changes ----
function toJqlMinute(iso) {
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function search(jql) {
  const res = await fetch(`${JIRA}/rest/api/2/search?jql=${encodeURIComponent(jql)}`)
  if (!res.ok) throw new Error(`search returned ${res.status}`)
  return (await res.json()).issues
}

async function poll() {
  const cycleStart = new Date().toISOString()
  try {
    const bound = lastPoll ? ` AND created >= "${toJqlMinute(lastPoll)}"` : ''
    for (const t of await search(`project = CIOPS AND labels = ci-failure${bound} ORDER BY created ASC`)) {
      if (issues.has(t.key)) continue
      const event = normalize(t)
      const issue = {
        event,
        ...classifyAndRoute(event),
        status: STATUS_BY_CATEGORY[t.fields.status.statusCategory.key] ?? 'new',
        receivedAt: new Date().toISOString()
      }
      issues.set(t.key, issue)
      console.log(`[svp-server] new ${t.key} → ${issue.assignment.assigneeId} (conf ${issue.classification.confidence})`)
      emitIssue('issue:new', issue)
    }
    if (lastPoll) {
      for (const t of await search(`project = CIOPS AND labels = ci-failure AND updated >= "${toJqlMinute(lastPoll)}"`)) {
        const issue = issues.get(t.key)
        const status = STATUS_BY_CATEGORY[t.fields.status.statusCategory.key]
        if (!issue || !status || issue.status === status) continue
        issue.status = status
        issue.event.jira.status = t.fields.status.statusCategory.key
        emitIssue('issue:updated', issue)
      }
    }
    lastPoll = cycleStart
  } catch (err) {
    console.error(`[svp-server] poll failed: ${err.message}`)
  }
}

console.log(`[svp-server] v3 prototype on http://localhost:${PORT}, polling ${JIRA} every ${POLL_MS}ms`)
void poll()
setInterval(() => void poll(), POLL_MS)
