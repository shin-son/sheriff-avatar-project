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
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Server } from 'socket.io'
import { loadIssueCache, saveIssueCache } from './cache.mjs'
import { classifierEnabled, classify } from './classifier.mjs'
import { extractBuildUrl, fetchFailureLog } from './jenkins.mjs'
import { fetchFailureLogViaSkill } from './ci-test-fetch.mjs'
import { INGEST_MODE, alreadyIngested, ingestResolved } from './ingest.mjs'
import { buildComment, postComment, setAssignee, transitionTo } from './jira.mjs'
import { listModules, queryWiki, resolveOwner } from './wiki-query.mjs'

const PORT = Number(process.env.SVP_SERVER_PORT ?? 8793)
const JIRA = process.env.SVP_JIRA_BASE_URL ?? 'http://localhost:8792'
const PAT = process.env.SVP_JIRA_PAT
const BOT = process.env.SVP_JIRA_BOT ?? 'cicd_ap'
const BASE_JQL = process.env.SVP_JIRA_JQL ?? 'project = CIOPS AND labels = ci-failure'
const POLL_MS = Number(process.env.SVP_SERVER_POLL_MS ?? 5000)
/** Auto-assign gate — strictly greater (ARCHITECTURE.md: >80 → owner, ≤80 → sheriff). */
const CONFIDENCE_MIN = Number(process.env.SVP_LLM_CONFIDENCE_MIN ?? 80)
// Every server-initiated Jira write (auto-assign trio AND app-ack transition)
// obeys this mode. Safe by default: 테스트 단계에서 실티켓이 바뀌면 안 된다.
//   dry-run(기본) → 로그만 | label → SVP_TEST_LABEL 붙은 티켓만 | live → 전면 허용
const WRITE_MODE = process.env.SVP_JIRA_WRITE_MODE ?? 'dry-run'
const TEST_LABEL = process.env.SVP_TEST_LABEL ?? 'svp-test'
// 설정 시 신규 티켓의 수집 로그(event.log: description + Jenkins 구간)를
// <dir>/<티켓키>.log로 저장 — ingest 전 수집 데이터 검증용. 기본 꺼짐.
const DUMP_DIR = process.env.SVP_DEBUG_DUMP_DIR

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
/** key → { receivedAt, log, url, classification? } — 초도분석 1회 보장 (disk-backed, cache.mjs). */
const issueCache = loadIssueCache()
/** key → LLM Classification — survives sync-loop re-routing (routeByAssignee consults it). */
const llmResults = new Map()
for (const [key, entry] of issueCache) if (entry.classification) llmResults.set(key, entry.classification)
/** key → Jira labels (server-internal; the app contract doesn't carry labels). */
const ticketLabels = new Map()

function canWrite(key) {
  if (WRITE_MODE === 'live') return true
  if (WRITE_MODE === 'label') return (ticketLabels.get(key) ?? []).includes(TEST_LABEL)
  return false
}
/** userIds ever seen (logins + assignees) — for the roster sent on login. */
const knownMembers = new Set()

// 실티켓 description은 HTML로 온다 (사내 실측: <h2>헤드라인</h2><ul><li>key : value</li>...).
// 블록 태그를 줄바꿈으로 바꾸고 태그를 걷어내 줄 단위 계약 파싱이 동작하게 한다.
// plain text에는 매칭될 태그가 없어 그대로 통과 — 두 형식 모두 처리된다.
function htmlToText(s) {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(h\d|li|ul|ol|p|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&quot;/g, "'")
}

// Real corporate description contract (SVP-6) — ` : `-separated key-value lines:
//   [DEV_CICD][<project>][T<seq>] : <TC명> Failed   ← first line (= summary)
//   CICD Project : ... / Step : TEST / Category : ... / TC name or file : ...
//   Link / CICD : <대시보드 URL> / TEST : <Jenkins 빌드 URL> / IMAGE·DUMP DIR : ...
// description에 실패 로그는 없다 — 로그는 poll()의 Jenkins consoleText 보강이 맡는다.
const STEP_TO_TYPE = {
  TEST: 'test_failed',
  BUILD: 'build_failed',
  DEPLOY: 'deploy_failed',
  LINT: 'lint_failed'
}

function normalize(t) {
  const text = htmlToText(t.fields.description ?? '')
  const fields = {}
  for (const line of text.split('\n')) {
    const sep = line.indexOf(' : ')
    if (sep > 0) fields[line.slice(0, sep).trim()] = line.slice(sep + 3).trim()
  }
  return {
    id: t.key,
    type: STEP_TO_TYPE[(fields['Step'] ?? '').toUpperCase()] ?? 'test_failed',
    title: t.fields.summary,
    module: 'unknown', // description에 모듈 정보 없음 — LLM 분류가 결정
    branch: fields['CICD Project'] ?? '',
    log: text,
    url: fields['CICD'] ?? `${JIRA}/browse/${t.key}`,
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
// An LLM classification (llmResults) outlives re-routing — without this the
// sync loop would overwrite the real confidence/summary with the placeholder.
function routeByAssignee(event, assignee, key) {
  const human = assignee && assignee !== BOT
  if (human) knownMembers.add(assignee)
  const llm = llmResults.get(key)
  return {
    classification: llm ?? {
      category: event.module,
      severity: SEVERITY_BY_TYPE[event.type] ?? 'major',
      confidence: human ? 95 : 50,
      summary: human
        ? `Jira에서 ${assignee}에게 배정된 티켓.`
        : `사람 배정 전 (assignee: ${assignee ?? '-'}) — 당번 확인 필요.`,
      wikiRefs: []
    },
    assignment: human
      ? {
          assigneeId: assignee,
          assigneeName: assignee,
          routedTo: 'feature-owner',
          reason: `Jira assignee = ${assignee}${llm ? ` (LLM 분류 ${llm.category} · 신뢰도 ${llm.confidence})` : ''}`
        }
      : { assigneeId: 'admin', assigneeName: '당번 (admin)', routedTo: 'sheriff', reason: `assignee가 ${assignee ?? '없음'} (사람 배정 전) → 당번` }
  }
}

// F3 — async classification: never blocks ingest. The server does not move
// local state itself: on a confident match it WRITES to Jira (assignee →
// comment → In Progress) and lets poll() read the change back and push it.
async function classifyAndAct(key) {
  const issue = issues.get(key)
  if (!issue) return
  const matches = queryWiki(issue.event)
  const llm = await classify(issue.event, matches, listModules())
  const wikiRefs = llm.evidence
    .map((e) => matches.find((m) => m.file === e) ?? { file: e, title: e, score: 0 })
    .map(({ file, title, score }) => ({ file, title, score }))
  const classification = {
    category: llm.category,
    severity: llm.severity,
    confidence: llm.confidence,
    summary: llm.summary,
    wikiRefs
  }
  llmResults.set(key, classification)
  const cached = issueCache.get(key)
  if (cached) {
    cached.classification = classification // restart-proof: never re-classify this ticket
    saveIssueCache(issueCache)
  }
  issue.classification = classification
  emitIssue('issue:updated', issue) // ≤80이어도 당번 화면에 LLM 판단 근거가 보인다

  // State may have moved during the LLM call (ack, manual assignment) — don't write over it.
  if (issue.assignment.routedTo !== 'sheriff' || issue.status !== 'new') return
  const owner =
    llm.confidence > CONFIDENCE_MIN && llm.category !== 'unknown' ? resolveOwner(llm.category) : null
  if (!owner) {
    console.log(`[svp-server] classified ${key}: ${llm.category}/${llm.confidence} → 당번 유지`)
    return
  }
  if (!canWrite(key)) {
    console.log(
      `[svp-server] [${WRITE_MODE}] ${key}: would assign → ${owner} (${llm.category}/${llm.confidence}, +댓글, In Progress) — Jira 변경 안 함`
    )
    return
  }
  try {
    // Assignee first — never post an "자동 배정" comment without an actual assignment.
    await setAssignee(key, owner)
  } catch (err) {
    console.error(`[svp-server] auto-assign failed for ${key}: ${err.message}`)
    return
  }
  console.log(`[svp-server] classified ${key}: ${llm.category}/${llm.confidence} → assignee=${owner}`)
  const reason = `LLM 분류 ${llm.category} (신뢰도 ${llm.confidence}) → ${llm.category} owner ${owner}`
  try {
    await postComment(key, buildComment(issue.event, llm, wikiRefs, `${llm.category} 담당 ${owner} 자동 배정`, reason))
  } catch (err) {
    console.error(`[svp-server] comment failed for ${key}: ${err.message}`) // 배정은 이미 성공 — 계속
  }
  try {
    await transitionTo(key, 'In Progress')
  } catch (err) {
    console.error(`[svp-server] transition failed for ${key}: ${err.message}`)
  }
  void poll() // sync 루프가 assignee/status 변경을 읽어 담당자에게 push한다
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
    if (!canWrite(issue.event.jira.key)) {
      console.log(
        `[svp-server] [${WRITE_MODE}] ack from ${user.userId}: would transition ${issue.event.jira.key} → In Progress — Jira 변경 안 함`
      )
      return
    }
    try {
      await transitionTo(issue.event.jira.key, 'In Progress')
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
  const url = `${JIRA}/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=summary,description,status,created,updated,assignee,labels`
  const res = await fetch(url, { headers: auth() })
  if (!res.ok) throw new Error(`search returned ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()).issues ?? []
}

// Jenkins fetch가 끼면서 poll 한 사이클이 수 초를 넘을 수 있다 — setInterval
// 겹침으로 같은 티켓이 두 번 ingest되는 것을 막는다 (single-flight).
let polling = false

async function poll() {
  if (polling) return
  polling = true
  try {
    // 1) New tickets: fetch the full base JQL and skip known keys. A `created >=`
    //    bound would be interpreted in the JIRA PROFILE timezone (not this PC's),
    //    which silently drops new tickets — and the active set is small anyway
    //    (the team JQL excludes Resolved).
    for (const t of await search(`(${BASE_JQL}) ORDER BY created ASC`)) {
      ticketLabels.set(t.key, t.fields.labels ?? [])
      if (issues.has(t.key)) continue
      const event = normalize(t)
      const cached = issueCache.get(t.key)
      if (cached) {
        // 초도분석이 이미 끝난 티켓(재시작 복원) — Jenkins 재수집 없이 캐시의
        // 보강 로그를 그대로 쓴다. 분류도 llmResults 복원으로 건너뛴다.
        event.log = cached.log
        event.url = cached.url
      } else {
        // Jenkins 실패 로그 보강 — description에는 로그가 없다. 1차: fetch-ci-log
        // 스킬(fetch_ci_test.py + 양식 재조합). 실패 시 기존 jenkins.mjs 직통
        // (TEST 링크에서 실패 샤드 콘솔 추적)으로 폴백, 그마저 실패(다운·
        // 타임아웃·링크 없음)면 description 로그 그대로 진행.
        // event.log = HTML을 걷어낸 description — 링크·TC명 추출도 여기서 한다
        // (raw HTML에서 하면 </li> 등이 TC명에 달라붙는다).
        const buildUrl = extractBuildUrl(event.log)
        const tc = event.log.match(/TC name or file\s*:\s*(\S+)/)?.[1]
        const jenkins = buildUrl
          ? ((await fetchFailureLogViaSkill(buildUrl, tc)) ?? (await fetchFailureLog(buildUrl, tc)))
          : null
        if (jenkins) {
          event.log = `${event.log}\n\n${jenkins.log}`
          event.url = jenkins.url
          console.log(`[svp-server] jenkins log for ${t.key}: ${jenkins.log.length} chars from ${jenkins.url}`)
        }
        if (DUMP_DIR) {
          try {
            mkdirSync(DUMP_DIR, { recursive: true })
            writeFileSync(join(DUMP_DIR, `${t.key}.log`), event.log)
          } catch (err) {
            console.error(`[svp-server] debug dump failed for ${t.key}: ${err.message}`)
          }
        }
      }
      const issue = {
        event,
        ...routeByAssignee(event, assigneeOf(t), t.key),
        status: STATUS_BY_CATEGORY[t.fields.status.statusCategory.key] ?? 'new',
        receivedAt: cached?.receivedAt ?? new Date().toISOString()
      }
      issues.set(t.key, issue)
      if (!cached) {
        issueCache.set(t.key, { receivedAt: issue.receivedAt, log: event.log, url: event.url })
        saveIssueCache(issueCache)
      }
      console.log(`[svp-server] ${cached ? 'restored' : 'new'} ${t.key} assignee=${assigneeOf(t) ?? '-'} → ${issue.assignment.assigneeId}`)
      // Restored issues re-enter the clients' lists but must not re-toast.
      emitIssue('issue:new', cached ? { ...issue, restored: true } : issue)
      // Classify only bot-assigned open tickets. Human-assigned tickets skip it,
      // which also makes restarts idempotent: an already-auto-assigned ticket
      // re-ingests with its human assignee and never gets a second comment.
      if (
        classifierEnabled() &&
        issue.assignment.routedTo === 'sheriff' &&
        issue.status === 'new' &&
        !llmResults.has(t.key)
      ) {
        void classifyAndAct(t.key)
      }
    }

    // 2) Tracked tickets: status/assignee sync by key — independent of the base
    //    JQL, so tickets that left it (e.g. `status != Resolved`) are still seen.
    const tracked = [...issues.entries()].filter(([, i]) => i.status !== 'resolved').map(([k]) => k)
    if (tracked.length > 0) {
      for (const t of await search(`key in (${tracked.join(',')})`)) {
        ticketLabels.set(t.key, t.fields.labels ?? [])
        const issue = issues.get(t.key)
        if (!issue) continue
        const status = STATUS_BY_CATEGORY[t.fields.status.statusCategory.key]
        const assignee = assigneeOf(t)
        const statusChanged = status && issue.status !== status
        const currentAssignee = issue.assignment.routedTo === 'sheriff' ? null : issue.assignment.assigneeId
        const assigneeChanged = (assignee && assignee !== BOT ? assignee : null) !== currentAssignee
        if (!statusChanged && !assigneeChanged) continue
        const before = issue.assignment.assigneeId
        if (assigneeChanged) Object.assign(issue, routeByAssignee(issue.event, assignee, t.key))
        if (statusChanged) issue.status = status
        issue.event.jira.status = t.fields.status.statusCategory.key
        console.log(`[svp-server] sync ${t.key}: status=${issue.status} assignee=${issue.assignment.assigneeId}${assigneeChanged ? ` (was ${before})` : ''}`)
        // The previous holder also gets the update so their list drops/updates it.
        emitIssue('issue:updated', issue, assigneeChanged ? [before] : [])
        // F7: on entering `resolved`, freeze evidence into the vault (once per key).
        if (statusChanged && status === 'resolved') {
          if (issueCache.delete(t.key)) saveIssueCache(issueCache) // 종결 — 캐시 정리
          if (!alreadyIngested(t.key)) {
            void ingestResolved(issue) // fire-and-forget — never block the poll loop
          }
        }
      }
    }
  } catch (err) {
    // undici hides the real reason (TLS/DNS/refused) in err.cause — surface it.
    const cause = err.cause ? ` (cause: ${err.cause.code ?? err.cause.message ?? err.cause})` : ''
    console.error(`[svp-server] poll failed: ${err.message}${cause}`)
  } finally {
    polling = false
  }
}

console.log(`[svp-server] v3 server listening on :${PORT}`)
console.log(`[svp-server] jira=${JIRA} bot=${BOT} jql=${BASE_JQL}`)
if (issueCache.size > 0)
  console.log(`[svp-server] issue-cache: ${issueCache.size} ticket(s) — 초도분석 완료분은 재수집·재분류 없이 복원`)
console.log(
  `[svp-server] classifier: ${classifierEnabled() ? `on (>${CONFIDENCE_MIN} → auto-assign)` : 'off — LLM 자격증명 없음, 티켓은 당번 큐에 유지'}`
)
console.log(
  `[svp-server] write-mode: ${WRITE_MODE}${
    WRITE_MODE === 'dry-run'
      ? ' — Jira 변경 없음 (로그로만 관찰)'
      : WRITE_MODE === 'label'
        ? ` — "${TEST_LABEL}" 라벨 티켓만 write`
        : ' — 전면 허용'
  }`
)
console.log(
  `[svp-server] ingest-mode: ${INGEST_MODE}${INGEST_MODE === 'live' ? ' — 해결 시 vault 동결' : ' — vault 변경 없음 (로그로만 관찰)'}${DUMP_DIR ? `\n[svp-server] debug-dump: ${DUMP_DIR} — 신규 티켓 수집 로그 저장` : ''}`
)
void poll()
setInterval(() => void poll(), POLL_MS)
