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
import { classifierEnabled, classify, selectNotes } from './classifier.mjs'
import { extractBuildUrl, fetchFailureLog, probeBuildUrl } from './jenkins.mjs'
import { fetchRawLogViaTool, formatLogViaSkill } from './ci-test-fetch.mjs'
import { INGEST_MODE, ingestResolved } from './ingest.mjs'
import { commentChannel, postAnalysisComment } from './comment-channel.mjs'
import { buildComment, postComment, setAssignee, transitionTo } from './jira.mjs'
import { normalize } from './ticket.mjs'
import { buildCandidates, listCatalog, listModules, queryWiki, readNotes, recordFeedback, resolveOwner } from './wiki-query.mjs'
import { lintWiki } from './wiki-lint.mjs'
import { isRetryableStatus, withRetry } from './retry.mjs'

const PORT = Number(process.env.SVP_SERVER_PORT ?? 8793)
const JIRA = process.env.SVP_JIRA_BASE_URL ?? 'http://localhost:8792'
const PAT = process.env.SVP_JIRA_PAT
const BOT = process.env.SVP_JIRA_BOT ?? 'cicd_ap'
const BASE_JQL = process.env.SVP_JIRA_JQL ?? 'project = CIOPS AND labels = ci-failure'
const POLL_MS = Number(process.env.SVP_SERVER_POLL_MS ?? 5000)
/** Auto-assign gate — strictly greater (ARCHITECTURE.md: >80 → owner, ≤80 → sheriff). */
const CONFIDENCE_MIN = Number(process.env.SVP_LLM_CONFIDENCE_MIN ?? 80)
// Every server-initiated Jira write (auto-assign trio AND manual reassign)
// obeys this mode. Safe by default: 테스트 단계에서 실티켓이 바뀌면 안 된다.
//   dry-run(기본) → 로그만 | label → SVP_TEST_LABEL 붙은 티켓만 | live → 전면 허용
const WRITE_MODE = process.env.SVP_JIRA_WRITE_MODE ?? 'dry-run'
const TEST_LABEL = process.env.SVP_TEST_LABEL ?? 'svp-test'
// 설정 시 신규 티켓의 수집 로그(event.log: description + Jenkins 구간)를
// <dir>/<티켓키>.log로 저장 — ingest 전 수집 데이터 검증용. 기본 꺼짐.
const DUMP_DIR = process.env.SVP_DEBUG_DUMP_DIR
// 테스트용 auto-assign 대상 고정 — 설정 시 wiki owner 대신 이 사용자로 배정
// (confidence 게이트는 그대로). 미설정/빈 값이면 정상 동작. 운영에서는 비워둔다.
const FORCE_ASSIGNEE = process.env.SVP_FORCE_ASSIGNEE || null

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

function assigneeOf(t) {
  return t.fields.assignee?.name ?? t.fields.assignee?.key ?? null
}

// Assignee-driven routing: Jira's assignee field is the single source of who
// owns the issue. bot/empty = not yet given to a human → sheriff queue.
// An LLM classification (llmResults) outlives re-routing — without this the
// sync loop would overwrite the real confidence/summary with the placeholder.
function routeByAssignee(event, assignee, key) {
  const human = assignee && assignee !== BOT
  if (human) addMember(assignee)
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
  // SVP-3 drill-down: LLM이 로그로 원인을 추정하고 카탈로그에서 읽을 노트를
  // 고른다. 키워드 매칭과 합집합 — 선택이 실패/공집합이면 키워드 결과로 진행.
  const keywordMatches = queryWiki(issue.event)
  const picked = await selectNotes(issue.event, listCatalog())
  if (picked.files.length > 0 || picked.hypothesis) {
    console.log(`[svp-server] note-select ${key}: [${picked.files.join(', ') || '없음'}] — ${picked.hypothesis}`)
  }
  const known = new Set(keywordMatches.map((m) => m.file))
  const matches = [...keywordMatches, ...readNotes(picked.files.filter((f) => !known.has(f)))]
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

  // State may have moved during the LLM call (ack, manual assignment) — don't auto-assign over it.
  const eligible = issue.assignment.routedTo === 'sheriff' && issue.status === 'new'
  const confident = llm.confidence > CONFIDENCE_MIN && llm.category !== 'unknown'
  const owner = eligible && confident ? (FORCE_ASSIGNEE ?? resolveOwner(llm.category)) : null
  if (!owner) {
    // confidence ≤ 80 또는 담당자 미등록 → 후보 리스트를 빌드해 당번 화면에 노출.
    if (eligible && !confident) {
      try {
        issue.candidates = await buildCandidates(issue.event, llm.category)
        if (issue.candidates.length > 0) {
          console.log(`[svp-server] candidates for ${key}: ${issue.candidates.map((c) => `${c.source}:${c.id}`).join(', ')}`)
          const cached2 = issueCache.get(key)
          if (cached2) { cached2.candidates = issue.candidates; saveIssueCache(issueCache) }
          emitIssue('issue:updated', issue)
        }
      } catch (err) {
        console.warn(`[svp-server] buildCandidates failed for ${key}: ${err.message}`)
      }
    }
    // 자동 배정 없음 — 분석 결과는 코멘트로 남긴다 (모든 신규 티켓에 분석 코멘트).
    console.log(`[svp-server] classified ${key}: ${llm.category}/${llm.confidence} → ${eligible ? '당번 유지' : '배정 변경 없음 (분류 중 상태 이동)'}`)
    const reason = !eligible
      ? `분류 완료 시점에 이미 처리 중 (assignee=${issue.assignment.assigneeId}, status=${issue.status}) → 배정 변경 없음`
      : confident
        ? `${llm.category} 담당자 미등록 → 당번 유지`
        : `신뢰도 ${llm.confidence} ≤ ${CONFIDENCE_MIN} → 당번 유지`
    const comment = buildComment(issue.event, llm, wikiRefs, '자동 배정 없음', reason)
    if (!canWrite(key)) {
      console.log(`[svp-server] [${WRITE_MODE}] ${key} 분석 코멘트 미리보기:\n${comment}`)
      return
    }
    try {
      await postAnalysisComment(key, comment)
      console.log(`[svp-server] analysis comment posted on ${key}`)
    } catch (err) {
      console.error(`[svp-server] analysis comment failed for ${key}: ${err.message}`)
    }
    return
  }
  const reason = `LLM 분류 ${llm.category} (신뢰도 ${llm.confidence}) → ${llm.category} owner ${owner}`
  const comment = buildComment(issue.event, llm, wikiRefs, `${llm.category} 담당 ${owner} 자동 배정`, reason)
  if (!canWrite(key)) {
    console.log(
      `[svp-server] [${WRITE_MODE}] ${key}: would assign → ${owner} (${llm.category}/${llm.confidence}, +댓글, In Progress) — Jira 변경 안 함`
    )
    // dry에서도 실제로 달릴 분석 코멘트를 검증할 수 있게 본문을 그대로 남긴다.
    console.log(`[svp-server] [${WRITE_MODE}] ${key} 코멘트 미리보기:\n${comment}`)
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
  try {
    await postAnalysisComment(key, comment)
  } catch (err) {
    console.error(`[svp-server] comment failed for ${key}: ${err.message}`) // 배정은 이미 성공 — 계속
  }
  try {
    await transitionTo(key, 'In Progress')
  } catch (err) {
    console.error(`[svp-server] transition failed for ${key}: ${err.message}`)
  }
  void syncTracked() // sync가 assignee/status 변경을 읽어 담당자에게 push한다 (수집과 독립)
}

// Restored ticket whose cached classification is confident but that is still
// with the sheriff (dry-run at classify time, setAssignee failure, or the
// assignee was reverted in Jira). The score is already final — redo only the
// assignment step: setAssignee, no re-classify, no second comment/transition.
async function reassignFromCache(key) {
  const issue = issues.get(key)
  const llm = llmResults.get(key)
  if (!issue || !llm) return
  if (!(llm.confidence > CONFIDENCE_MIN && llm.category !== 'unknown')) return
  const owner = FORCE_ASSIGNEE ?? resolveOwner(llm.category)
  if (!owner) return
  if (!canWrite(key)) {
    console.log(
      `[svp-server] [${WRITE_MODE}] ${key}: would re-assign → ${owner} (cached ${llm.category}/${llm.confidence}) — Jira 변경 안 함`
    )
    return
  }
  try {
    await setAssignee(key, owner)
  } catch (err) {
    console.error(`[svp-server] re-assign failed for ${key}: ${err.message}`)
    return
  }
  console.log(`[svp-server] re-assigned ${key} from cache: ${llm.category}/${llm.confidence} → assignee=${owner}`)
  void syncTracked() // sync가 assignee 변경을 읽어 담당자에게 push한다
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

// Assignable people = everyone who logged in + every wiki module owner (they
// must be assignable before their first login). ownedModules comes from the
// module-note frontmatter so the client can rank module owners first (F4).
function roster() {
  const modules = listModules()
  // 다중 담당 모듈(owners 블록 리스트)은 전원이 배정 가능해야 한다.
  const ids = new Set([...knownMembers, ...modules.flatMap((m) => m.owners)])
  ids.delete('admin')
  ids.delete(BOT)
  return [
    { id: 'admin', name: '당번 (admin)', role: 'sheriff', ownedModules: [] },
    ...[...ids].map((id) => ({
      id,
      name: id,
      role: 'member',
      ownedModules: modules.filter((m) => m.owners.includes(id)).map((m) => m.module)
    }))
  ]
}

// 새 팀원이 나타나면(로그인·신규 assignee) 접속 중인 모든 세션에 roster를
// 다시 내려준다 — 없으면 당번의 배정 후보 목록이 로그인 시점 스냅샷에
// 갇힌다 (F4: 팀원이 나중에 로그인하면 피커에 안 보이는 문제).
function addMember(id) {
  if (!id || knownMembers.has(id)) return
  knownMembers.add(id)
  for (const [, s] of sessions)
    s.socket.emit('session', { user: s.socket.data.user, team: roster(), confidenceMin: CONFIDENCE_MIN })
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
  if (user.role === 'member') addMember(user.userId)
  sessions.get(user.userId)?.socket.disconnect(true)
  sessions.set(user.userId, { socket, role: user.role })

  // confidenceMin: 앱의 브래스 스타 표기가 서버 게이트와 같은 기준을 쓰게 한다.
  socket.emit('session', { user, team: roster(), confidenceMin: CONFIDENCE_MIN })
  // Replay this session's visible unresolved issues (login/reconnect restore).
  const visible = [...issues.values()].filter(
    (i) => i.status !== 'resolved' && (user.role === 'sheriff' || i.assignment.assigneeId === user.userId)
  )
  visible.forEach((i) => socket.emit('issue:new', i))
  console.log(`[svp-server] ${user.userId} logged in as ${user.role} (${visible.length} issue(s) restored)`)

  // C→S: sheriff manually assigns the issue (F4, API.md §1). Jira assignee is
  // the source of truth — write it there and let the tracked-key sync route the
  // change back to old/new holders, exactly like the auto-assign path.
  socket.on('issue:reassign', async (payload) => {
    if (user.role !== 'sheriff') return
    const issue = [...issues.values()].find((i) => i.event.id === payload?.issueId)
    const assigneeId = String(payload?.assigneeId ?? '')
    if (!issue || issue.status === 'resolved' || !assigneeId) return
    const key = issue.event.jira.key
    if (!canWrite(key)) {
      console.log(
        `[svp-server] [${WRITE_MODE}] reassign from ${user.userId}: would assign ${key} → ${assigneeId} (+댓글) — Jira 변경 안 함`
      )
      return
    }
    try {
      await setAssignee(key, assigneeId)
      console.log(`[svp-server] reassign from ${user.userId}: ${key} → ${assigneeId}`)
    } catch (err) {
      console.error(`[svp-server] reassign failed for ${key}: ${err.message}`)
      return
    }
    try {
      await postComment(key, `[SVP] 당번(${user.userId}) 수동 배정 → ${assigneeId}`)
    } catch (err) {
      console.error(`[svp-server] reassign comment failed for ${key}: ${err.message}`) // 배정은 성공 — 계속
    }
    void poll() // sync가 assignee 변경을 읽어 기존/신규 담당자에게 issue:updated push
  })

  // C→S: 담당자의 노트 원인 일치/불일치 피드백 → 서버 vault에 누적 (queryWiki 감점, F8).
  socket.on('wiki:feedback', (payload) => {
    const note = String(payload?.note ?? '')
    if (!note) return
    const e = recordFeedback(note, Boolean(payload?.helpful))
    console.log(`[svp-server] feedback from ${user.userId}: 『${note}』 ${payload?.helpful ? '일치' : '불일치'} (up=${e.up} down=${e.down})`)
  })

  // C→S: 당번의 수동 lint 트리거 (제안 4 Phase 1) — 서버 vault 점검 결과를 ack로 반환.
  socket.on('wiki:lint', (ack) => {
    if (user.role !== 'sheriff' || typeof ack !== 'function') return
    try {
      // 공백 탐지 입력: 현재 서버가 아는 티켓들의 모듈/분류 (inverse lint).
      const tickets = [...issues.values()].map((i) => ({
        key: i.event.jira?.key ?? i.event.id,
        module: i.event.module,
        category: i.classification.category
      }))
      const report = lintWiki(tickets)
      console.log(
        `[svp-server] lint by ${user.userId}: notes=${report.noteCount} orphans=${report.orphanNotes.length} unhelpful=${report.unhelpfulNotes.length} health=${report.healthScore}`
      )
      ack(report)
    } catch (err) {
      console.error(`[svp-server] lint failed: ${err.message}`)
      ack(null)
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
  // 순간 장애는 재시도(지수 백오프) — 폴링 한 사이클을 통째로 잃지 않기 위해. 4xx(JQL 오류 등)는 즉시 실패.
  return withRetry(async () => {
    const res = await fetch(url, { headers: auth() })
    if (!res.ok) {
      const err = new Error(`search returned ${res.status}: ${(await res.text()).slice(0, 200)}`)
      err.permanent = !isRetryableStatus(res.status)
      throw err
    }
    return (await res.json()).issues ?? []
  }, { label: 'jira search' })
}

// Jenkins fetch가 끼면서 신규 수집 한 사이클이 수 초를 넘을 수 있다 — setInterval
// 겹침으로 같은 티켓이 두 번 수집되는 것을 막는다 (single-flight). 수집과 sync는
// 가드를 분리 — 초도 수집(캐시 삭제 후 다건)이 오래 걸려도 sync는 그동안 계속
// 돌아 자동 배정 결과가 수집 완료를 기다리지 않고 UI에 반영된다.
let collecting = false

async function collectNew() {
  if (collecting) return
  collecting = true
  try {
    // 1) New tickets: fetch the full base JQL and skip known keys. A `created >=`
    //    bound would be interpreted in the JIRA PROFILE timezone (not this PC's),
    //    which silently drops new tickets — and the active set is small anyway
    //    (the team JQL excludes Resolved).
    for (const t of await search(`(${BASE_JQL}) ORDER BY created ASC`)) {
      ticketLabels.set(t.key, t.fields.labels ?? [])
      if (issues.has(t.key)) continue
      const event = normalize(t, JIRA)
      const cached = issueCache.get(t.key)
      if (cached) {
        // 초도분석이 이미 끝난 티켓(재시작 복원) — Jenkins 재수집 없이 캐시의
        // 보강 로그를 그대로 쓴다. 분류도 llmResults 복원으로 건너뛴다.
        event.log = cached.log
        event.url = cached.url
      } else {
        // Jenkins 실패 로그 보강 — description에는 로그가 없다. 확보는 1차
        // fetch_ci_test.py 직접 실행, 실패 시 기존 jenkins.mjs 직통(TEST 링크
        // 에서 실패 샤드 콘솔 추적) 폴백, 그마저 실패(다운·타임아웃·링크 없음)
        // 면 description 로그 그대로 진행. 확보된 로그는 format-ci-log 스킬로
        // 양식화하되 실패하면 raw 그대로 쓴다.
        // event.log = HTML을 걷어낸 description — 링크·TC명 추출도 여기서 한다
        // (raw HTML에서 하면 </li> 등이 TC명에 달라붙는다).
        const buildUrl = extractBuildUrl(event.log)
        // 티켓 TC명은 <os도메인>.<테스트명>.sh|py — 콘솔 마커와 fetch_ci_test.py
        // 인자는 도메인 접두사 없는 순수 테스트명을 쓴다. 도메인이 없으면 그대로.
        // ('Link'는 description 렌더링에 따라 다음 헤더가 달라붙는 경우 정리.)
        const rawTc = event.log.match(/TC name or file\s*:\s*(\S+)/)?.[1]
        const tc = rawTc?.replace(/Link$/, '').replace(/^[^.]+\.(?=.+\.(?:sh|py)$)/, '')
        let jenkins = null
        if (buildUrl && !(await probeBuildUrl(buildUrl))) {
          // 접근 불가 링크 — fetch(스킬·직통)만 건너뛰고 dump·분류는 description
          // 로그로 그대로 진행. 무효 URL 흔적은 dump에도 남도록 log에 기록한다.
          event.log = `${event.log}\n\n[jenkins] unreachable build url: ${buildUrl}`
          console.log(`[svp-server] jenkins build url unreachable for ${t.key}: ${buildUrl}`)
        } else if (buildUrl) {
          const raw = await fetchRawLogViaTool(buildUrl, tc)
          jenkins = raw
            ? { url: buildUrl, log: `[ci-test tool] ${buildUrl}\n${raw}` }
            : await fetchFailureLog(buildUrl, tc)
          if (jenkins) jenkins = { ...jenkins, log: (await formatLogViaSkill(jenkins.log)) ?? jenkins.log }
        }
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
      // Restore the human-in-the-loop candidate list frozen at classify time —
      // llmResults 복원으로 classifyAndAct가 재실행되지 않으므로 캐시에서 되살린다.
      if (cached?.candidates) issue.candidates = cached.candidates
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
      // Already-classified tickets still with the sheriff redo the assignment
      // step only (reassignFromCache) — the cached score stays authoritative.
      if (classifierEnabled() && issue.assignment.routedTo === 'sheriff' && issue.status === 'new') {
        void (llmResults.has(t.key) ? reassignFromCache(t.key) : classifyAndAct(t.key))
      }
    }
  } catch (err) {
    // undici hides the real reason (TLS/DNS/refused) in err.cause — surface it.
    const cause = err.cause ? ` (cause: ${err.cause.code ?? err.cause.message ?? err.cause})` : ''
    console.error(`[svp-server] collect failed: ${err.message}${cause}`)
  } finally {
    collecting = false
  }
}

// sync 겹침은 같은 티켓의 이중 ingest로 이어질 수 있어 single-flight는 유지하되,
// 진행 중에 들어온 호출(classifyAndAct의 배정 직후 재읽기)은 버리지 않고 사이클
// 종료 후 한 번 더 돈다 — 배정 결과 push가 다음 tick까지 밀리지 않게.
let syncing = false
let syncAgain = false

async function syncTracked() {
  if (syncing) {
    syncAgain = true
    return
  }
  syncing = true
  try {
    // 2) Tracked tickets: status/assignee sync by key — independent of the base
    //    JQL, so tickets that left it (e.g. `status != Resolved`) are still seen.
    // resolved 티켓도 포함 — reopen(resolved→open) 전이를 감지하려면 계속 재조회해야 한다.
    const tracked = [...issues.keys()]
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
        const wasResolved = issue.status === 'resolved'
        if (assigneeChanged) Object.assign(issue, routeByAssignee(issue.event, assignee, t.key))
        if (statusChanged) issue.status = status
        issue.event.jira.status = t.fields.status.statusCategory.key
        console.log(`[svp-server] sync ${t.key}: status=${issue.status} assignee=${issue.assignment.assigneeId}${assigneeChanged ? ` (was ${before})` : ''}`)
        // The previous holder also gets the update so their list drops/updates it.
        emitIssue('issue:updated', issue, assigneeChanged ? [before] : [])
        // Reopen (resolved → open): 다시 활성 큐로 복귀. 재시작 후에도 재추적되도록 캐시를 복원한다.
        if (wasResolved && status && status !== 'resolved') {
          issueCache.set(t.key, {
            receivedAt: issue.receivedAt,
            log: issue.event.log,
            url: issue.event.url,
            classification: issue.classification
          })
          saveIssueCache(issueCache)
          console.log(`[svp-server] reopened ${t.key} → 활성 큐 복귀`)
        }
        // F7: on entering `resolved`, ingest evidence. 멱등성은 resolvedAt(Jira updated)
        // 기준으로 ingestResolved 내부에서 판정 — reopen 후 재해결도 버전 raw로 안전 재기록.
        if (statusChanged && status === 'resolved') {
          if (issueCache.delete(t.key)) saveIssueCache(issueCache) // 종결 — 캐시 정리
          void ingestResolved(issue, t.fields.updated) // fire-and-forget — never block the poll loop
        }
      }
    }
  } catch (err) {
    // undici hides the real reason (TLS/DNS/refused) in err.cause — surface it.
    const cause = err.cause ? ` (cause: ${err.cause.code ?? err.cause.message ?? err.cause})` : ''
    console.error(`[svp-server] sync failed: ${err.message}${cause}`)
  } finally {
    syncing = false
    if (syncAgain) {
      syncAgain = false
      void syncTracked()
    }
  }
}

function poll() {
  void collectNew()
  void syncTracked()
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
if (FORCE_ASSIGNEE)
  console.log(`[svp-server] ⚠ FORCE_ASSIGNEE=${FORCE_ASSIGNEE} — 모든 auto-assign이 이 사용자로 고정 (테스트용, 운영에서는 해제)`)
console.log(`[svp-server] comment-channel: ${commentChannel()} — 분류 완료 시 분석 코멘트 (write 게이트 적용)`)
console.log(
  `[svp-server] ingest-mode: ${INGEST_MODE}${INGEST_MODE === 'live' ? ' — 해결 시 vault 동결' : ' — vault 변경 없음 (로그로만 관찰)'}${DUMP_DIR ? `\n[svp-server] debug-dump: ${DUMP_DIR} — 신규 티켓 수집 로그 저장` : ''}`
)
poll()
setInterval(poll, POLL_MS)
