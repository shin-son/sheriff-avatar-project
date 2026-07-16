// SVP v3 server — a standalone headless pipeline: polls Jira → routes by the
// ticket's ASSIGNEE → Socket.IO push with SERVER-SIDE filtering. Clients log in
// (demo auth until SVP-5) and the server tells them their role; the app renders
// member/sheriff view from that. Runs anywhere Node 20+ runs — production home
// is a Linux host under systemd (docs/SETUP.md "Linux 서버 배포").
//
// Routing model (사내 운용 가정):
//  - assignee == bot(cicd_ap) or empty  → 사람 배정 전 → sheriff(admin) queue
//  - assignee == a human username       → pushed to that user's session
//  - assignee/status changes are detected via `key in (...)` tracking, so a
//    base JQL like `status != Resolved` still lets us see the Resolved event.
//
// Works against mock/jira-server.mjs (default) or a real Jira via .env:
//   SVP_JIRA_BASE_URL, SVP_JIRA_JQL, SVP_JIRA_PAT, SVP_JIRA_BOT
//   (+ NODE_EXTRA_CA_CERTS in the shell for corporate TLS)
// Usage: npm run server  (port 8793)
import 'dotenv/config'
import { Server } from 'socket.io'

const PORT = Number(process.env.SVP_SERVER_PORT ?? 8793)
const JIRA = process.env.SVP_JIRA_BASE_URL ?? 'http://localhost:8792'
const PAT = process.env.SVP_JIRA_PAT
const BOT = process.env.SVP_JIRA_BOT ?? 'cicd_ap'
const BASE_JQL = process.env.SVP_JIRA_JQL ?? 'project = CIOPS AND labels = ci-failure'
const POLL_MS = Number(process.env.SVP_SERVER_POLL_MS ?? 5000)

// Demo auth until SVP-5: admin/admin → sheriff; any username with
// password === username → member (e.g. shin.son / shin.son).
function authenticate(username, password) {
  if (!username || password !== username) return null
  return username === 'admin'
    ? { userId: 'admin', role: 'sheriff' }
    : { userId: username, role: 'member' }
}

const SEVERITY_BY_TYPE = {
  build_failed: 'critical',
  deploy_failed: 'critical',
  test_failed: 'major',
  lint_failed: 'minor'
}
const STATUS_BY_CATEGORY = { new: 'new', indeterminate: 'acknowledged', done: 'resolved' }

/** key → SheriffIssue (the server owns the issue store in v3). */
const issues = new Map()
/** userIds ever seen (logins + assignees) — for the roster sent on login. */
const knownMembers = new Set()

// description contract: `key: value` header lines, then `log:` + raw log
// (mock contract; real corporate tickets just fall back to defaults).
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

function assigneeOf(t) {
  return t.fields.assignee?.name ?? t.fields.assignee?.key ?? null
}

// Assignee-driven routing: Jira's assignee field is the single source of who
// owns the issue. bot/empty = not yet given to a human → sheriff queue.
function routeByAssignee(event, assignee) {
  const human = assignee && assignee !== BOT
  if (human) knownMembers.add(assignee)
  return {
    classification: {
      category: event.module,
      severity: SEVERITY_BY_TYPE[event.type] ?? 'major',
      confidence: human ? 95 : 50,
      summary: human
        ? `Jira에서 ${assignee}에게 배정된 티켓.`
        : `사람 배정 전 (assignee: ${assignee ?? '-'}) — 당번 확인 필요.`,
      wikiRefs: []
    },
    assignment: human
      ? { assigneeId: assignee, assigneeName: assignee, routedTo: 'feature-owner', reason: `Jira assignee = ${assignee}` }
      : { assigneeId: 'admin', assigneeName: '당번 (admin)', routedTo: 'sheriff', reason: `assignee가 ${assignee ?? '없음'} (사람 배정 전) → 당번` }
  }
}

// ---- Socket.IO: login-authenticated sessions, server-side filtering ----
const io = new Server(PORT)
const sessions = new Map() // userId → { socket, role }

io.use((socket, next) => {
  const { username, password } = socket.handshake.auth ?? {}
  const user = authenticate(String(username ?? ''), String(password ?? ''))
  if (!user) return next(new Error('AUTH_FAILED'))
  socket.data.user = user
  next()
})

function roster() {
  return [
    { id: 'admin', name: '당번 (admin)', role: 'sheriff', ownedModules: [] },
    ...[...knownMembers].map((id) => ({ id, name: id, role: 'member', ownedModules: [] }))
  ]
}

function recipientsOf(issue, extra = []) {
  const ids = new Set(extra)
  ids.add(issue.assignment.assigneeId)
  for (const [id, s] of sessions) if (s.role === 'sheriff') ids.add(id)
  return ids
}

function emitIssue(type, issue, extra = []) {
  const targets = recipientsOf(issue, extra)
  for (const id of targets) sessions.get(id)?.socket.emit(type, issue)
  console.log(`[svp-server] → ${type} ${issue.event.jira.key} (${issue.status}, assignee=${issue.assignment.assigneeId}) → ${[...targets].join(', ')}`)
}

io.on('connection', (socket) => {
  const user = socket.data.user
  if (user.role === 'member') knownMembers.add(user.userId)
  sessions.get(user.userId)?.socket.disconnect(true)
  sessions.set(user.userId, { socket, role: user.role })

  socket.emit('session', { user, team: roster() })
  // Replay this session's visible unresolved issues (login/reconnect restore).
  const visible = [...issues.values()].filter(
    (i) => i.status !== 'resolved' && (user.role === 'sheriff' || i.assignment.assigneeId === user.userId)
  )
  visible.forEach((i) => socket.emit('issue:new', i))
  console.log(`[svp-server] ${user.userId} logged in as ${user.role} (${visible.length} issue(s) restored)`)

  // C→S: the assignee checked the ticket — transition it in Jira.
  // Status flows back via polling, never written locally (Jira = source of truth).
  socket.on('issue:ack', async (payload) => {
    const issue = [...issues.values()].find((i) => i.event.id === payload?.issueId)
    if (!issue || issue.status !== 'new') return
    try {
      const url = `${JIRA}/rest/api/2/issue/${issue.event.jira.key}/transitions`
      const { transitions } = await (await fetch(url, { headers: auth() })).json()
      // TODO(SVP-6): match by statusCategory once the corporate workflow is confirmed.
      const target = transitions.find((t) => t.name === 'In Progress')
      if (!target) throw new Error('no "In Progress" transition')
      await fetch(url, {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ transition: { id: target.id } })
      })
      console.log(`[svp-server] ack from ${user.userId}: ${issue.event.jira.key} → In Progress`)
      void poll()
    } catch (err) {
      console.error(`[svp-server] ack transition failed: ${err.message}`)
    }
  })

  socket.on('disconnect', () => {
    if (sessions.get(user.userId)?.socket === socket) sessions.delete(user.userId)
    console.log(`[svp-server] ${user.userId} disconnected`)
  })
})

// ---- Jira polling: new tickets (base JQL) + tracked-key sync ----
function auth() {
  return PAT ? { Authorization: `Bearer ${PAT}` } : {}
}

async function search(jql) {
  const url = `${JIRA}/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=summary,description,status,created,updated,assignee`
  const res = await fetch(url, { headers: auth() })
  if (!res.ok) throw new Error(`search returned ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()).issues ?? []
}

async function poll() {
  try {
    // 1) New tickets: fetch the full base JQL and skip known keys. A `created >=`
    //    bound would be interpreted in the JIRA PROFILE timezone (not this PC's),
    //    which silently drops new tickets — and the active set is small anyway
    //    (the team JQL excludes Resolved).
    for (const t of await search(`(${BASE_JQL}) ORDER BY created ASC`)) {
      if (issues.has(t.key)) continue
      const event = normalize(t)
      const issue = {
        event,
        ...routeByAssignee(event, assigneeOf(t)),
        status: STATUS_BY_CATEGORY[t.fields.status.statusCategory.key] ?? 'new',
        receivedAt: new Date().toISOString()
      }
      issues.set(t.key, issue)
      console.log(`[svp-server] new ${t.key} assignee=${assigneeOf(t) ?? '-'} → ${issue.assignment.assigneeId}`)
      emitIssue('issue:new', issue)
    }

    // 2) Tracked tickets: status/assignee sync by key — independent of the base
    //    JQL, so tickets that left it (e.g. `status != Resolved`) are still seen.
    const tracked = [...issues.entries()].filter(([, i]) => i.status !== 'resolved').map(([k]) => k)
    if (tracked.length > 0) {
      for (const t of await search(`key in (${tracked.join(',')})`)) {
        const issue = issues.get(t.key)
        if (!issue) continue
        const status = STATUS_BY_CATEGORY[t.fields.status.statusCategory.key]
        const assignee = assigneeOf(t)
        const statusChanged = status && issue.status !== status
        const currentAssignee = issue.assignment.routedTo === 'sheriff' ? null : issue.assignment.assigneeId
        const assigneeChanged = (assignee && assignee !== BOT ? assignee : null) !== currentAssignee
        if (!statusChanged && !assigneeChanged) continue
        const before = issue.assignment.assigneeId
        if (assigneeChanged) Object.assign(issue, routeByAssignee(issue.event, assignee))
        if (statusChanged) issue.status = status
        issue.event.jira.status = t.fields.status.statusCategory.key
        console.log(`[svp-server] sync ${t.key}: status=${issue.status} assignee=${issue.assignment.assigneeId}${assigneeChanged ? ` (was ${before})` : ''}`)
        // The previous holder also gets the update so their list drops/updates it.
        emitIssue('issue:updated', issue, assigneeChanged ? [before] : [])
      }
    }
  } catch (err) {
    // undici hides the real reason (TLS/DNS/refused) in err.cause — surface it.
    const cause = err.cause ? ` (cause: ${err.cause.code ?? err.cause.message ?? err.cause})` : ''
    console.error(`[svp-server] poll failed: ${err.message}${cause}`)
  }
}

console.log(`[svp-server] v3 server listening on :${PORT}`)
console.log(`[svp-server] jira=${JIRA} bot=${BOT} jql=${BASE_JQL}`)
void poll()
setInterval(() => void poll(), POLL_MS)
