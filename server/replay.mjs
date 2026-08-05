// Replay measurement — dry-run 실측 도구 (제품 경로 아님, 서버 기동 불필요).
// 해결 완료된 티켓을 read-only로 수집해 분류 파이프라인을 재생하고, 예측 담당자를
// 실제 해결자(ground truth)와 대조해 정확도·자동 배정률을 집계한다.
//
//   node server/replay.mjs collect --jql "<JQL>" --max 200   # 티켓+로그 수집 (LLM 없음, 재개 가능)
//   node server/replay.mjs run [--half 1|2] [--out p.jsonl]  # 분류 재생 (LLM, 재개 가능)
//   node server/replay.mjs score --pred p.jsonl [--truth t.csv]  # 집계 (LLM 없음)
//   node server/replay.mjs ingest-half --half 1 --pred p.jsonl   # C모드: vault 축적 (SVP_INGEST_MODE=live 필요)
//
// ground truth 격리: 해결자(assignee)는 truth 필드에만 저장되고 분류 프롬프트에는
// 절대 들어가지 않는다 (event는 description 기반 — ticket.mjs normalize와 동일).
// replay-data/·truth CSV는 사내 데이터(실명·티켓 원문) — gitignore, 반출은 score 출력만.
import 'dotenv/config'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalize } from './ticket.mjs'
import { extractBuildUrl, fetchFailureLog, probeBuildUrl } from './jenkins.mjs'
import { fetchRawLogViaTool, formatLogViaSkill } from './ci-test-fetch.mjs'
import { classify, selectNotes } from './classifier.mjs'
import { listCatalog, listModules, queryWiki, readNotes, resolveOwner } from './wiki-query.mjs'
import { ingestResolved } from './ingest.mjs'

const JIRA = process.env.SVP_JIRA_BASE_URL ?? 'http://localhost:8792'
const PAT = process.env.SVP_JIRA_PAT
const DATA_DIR = process.env.SVP_REPLAY_DIR ?? join(dirname(fileURLToPath(import.meta.url)), 'replay-data')
const TICKETS_DIR = join(DATA_DIR, 'tickets')
const AUTO_MIN = Number(process.env.SVP_LLM_CONFIDENCE_MIN ?? 80)

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

function auth() {
  return PAT ? { Authorization: `Bearer ${PAT}` } : {}
}

/* ── collect — read-only 수집: 티켓 + Jenkins 로그 + truth 분리 저장 ──────── */

// index.mjs poll()의 Jenkins 보강과 동일한 체인 — 분류 입력의 충실도를 맞추기
// 위한 의도적 복제 (index.mjs는 import 시 서버가 떠서 재사용 불가).
async function enrich(event) {
  const buildUrl = extractBuildUrl(event.log)
  if (!buildUrl) return false
  const rawTc = event.log.match(/TC name or file\s*:\s*(\S+)/)?.[1]
  const tc = rawTc?.replace(/Link$/, '').replace(/^[^.]+\.(?=.+\.(?:sh|py)$)/, '')
  if (!(await probeBuildUrl(buildUrl))) {
    event.log = `${event.log}\n\n[jenkins] unreachable build url: ${buildUrl}`
    return false
  }
  const raw = await fetchRawLogViaTool(buildUrl, tc)
  let jenkins = raw ? { url: buildUrl, log: `[ci-test tool] ${buildUrl}\n${raw}` } : await fetchFailureLog(buildUrl, tc)
  if (jenkins) jenkins = { ...jenkins, log: (await formatLogViaSkill(jenkins.log)) ?? jenkins.log }
  if (!jenkins) return false
  event.log = `${event.log}\n\n${jenkins.log}`
  event.url = jenkins.url
  return true
}

async function collect({ jql, max }) {
  if (!jql) throw new Error('--jql 필요 (예: "<기존 JQL> AND resolution = Done AND resolved >= -14d")')
  mkdirSync(TICKETS_DIR, { recursive: true })
  let startAt = 0
  let seen = 0
  while (seen < max) {
    const url = `${JIRA}/rest/api/2/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=50&fields=summary,description,status,created,updated,assignee,resolutiondate`
    const res = await fetch(url, { headers: auth() })
    if (!res.ok) throw new Error(`search ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const body = await res.json()
    const tickets = body.issues ?? []
    if (tickets.length === 0) break
    for (const t of tickets) {
      if (seen >= max) break
      seen += 1
      const file = join(TICKETS_DIR, `${t.key}.json`)
      if (existsSync(file)) continue // 재개: 이미 수집된 티켓은 재fetch 없음
      const event = normalize(t, JIRA)
      const jenkinsLog = await enrich(event)
      const truth = {
        assignee: t.fields.assignee?.name ?? t.fields.assignee?.key ?? null,
        resolvedAt: t.fields.resolutiondate ?? t.fields.updated
      }
      writeFileSync(file, JSON.stringify({ key: t.key, event, jenkinsLog, truth }, null, 2))
      console.log(`[replay] collected ${t.key} (jenkins=${jenkinsLog} log=${event.log.length}자 truth=${truth.assignee ?? '-'})`)
    }
    startAt += tickets.length
    if (startAt >= (body.total ?? 0)) break
  }
  console.log(`[replay] collect 완료: ${readdirSync(TICKETS_DIR).length}건 in ${TICKETS_DIR}`)
}

/* ── run — 분류 재생: event만 사용, truth는 절대 프롬프트로 가지 않는다 ────── */

function loadTickets() {
  return readdirSync(TICKETS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(TICKETS_DIR, f), 'utf-8')))
    .sort((a, b) => String(a.truth.resolvedAt).localeCompare(String(b.truth.resolvedAt)))
}

function halfOf(list, half) {
  if (half !== '1' && half !== '2') return list
  const mid = Math.floor(list.length / 2)
  return half === '1' ? list.slice(0, mid) : list.slice(mid)
}

async function run({ half, out }) {
  const predFile = join(DATA_DIR, out)
  const done = new Set(
    existsSync(predFile)
      ? readFileSync(predFile, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l).key)
      : []
  )
  const targets = halfOf(loadTickets(), half).filter((t) => !done.has(t.key))
  // 멀티-owner 모듈(owner: 블록 리스트): 예측은 제품과 동일하게 owners[0]이지만,
  // "올바른 팀으로 갔는가" 채점을 위해 전체 목록도 기록한다.
  const ownersOf = new Map(listModules().map((m) => [m.module, m.owners ?? [m.owner]]))
  console.log(`[replay] run: ${targets.length}건 (완료 ${done.size}건 스킵, half=${half ?? '전체'}) → ${predFile}`)
  for (const [i, t] of targets.entries()) {
    const keywordMatches = queryWiki(t.event)
    const picked = await selectNotes(t.event, listCatalog())
    const known = new Set(keywordMatches.map((m) => m.file))
    const matches = [...keywordMatches, ...readNotes(picked.files.filter((f) => !known.has(f)))]
    const llm = await classify(t.event, matches, listModules())
    const rec = {
      key: t.key,
      category: llm.category,
      confidence: llm.confidence,
      owner: resolveOwner(llm.category),
      owners: ownersOf.get(llm.category) ?? [],
      fallback: llm.summary?.startsWith('LLM 분류 실패') ?? false,
      jenkinsLog: t.jenkinsLog ?? false
    }
    appendFileSync(predFile, JSON.stringify(rec) + '\n')
    console.log(`[replay] ${i + 1}/${targets.length} ${t.key}: ${rec.category}/${rec.confidence} → ${rec.owner ?? '-'}${rec.fallback ? ' (fallback)' : ''}`)
  }
}

/* ── score — 채점: truth는 여기서만 사용. 출력은 집계 수치뿐 (반출 가능) ───── */

// truth CSV(더미 복사본 모드): dummy_key,원본_key,원본_assignee[,...] — 3열 이상이면
// 1열→3열 매핑, 2열이면 key,assignee. 헤더 행은 assignee 미포함이면 데이터로 오인되므로 넣지 말 것.
function loadTruthCsv(file) {
  const map = new Map()
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const cols = line.split(',').map((c) => c.trim())
    if (cols.length >= 3 && cols[0]) map.set(cols[0], cols[2])
    else if (cols.length === 2 && cols[0]) map.set(cols[0], cols[1])
  }
  return map
}

function pct(n, d) {
  return d === 0 ? '-' : `${((n / d) * 100).toFixed(1)}%`
}

function score({ pred, truthCsv }) {
  const preds = readFileSync(join(DATA_DIR, pred), 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const tickets = new Map(loadTickets().map((t) => [t.key, t]))
  const override = truthCsv ? loadTruthCsv(truthCsv) : null

  // --truth가 주어지면 CSV가 유일한 정답 소스 — 없는 키는 '정답 없음'으로 제외한다.
  // (티켓 assignee 폴백은 클론 환경에서 봇(cicd_ap)을 정답으로 삼아 점수를 희석시킨다.)
  const rows = preds.map((p) => ({
    ...p,
    truth: override ? (override.get(p.key) ?? null) : (tickets.get(p.key)?.truth.assignee ?? null)
  }))
  const noTruth = rows.filter((r) => !r.truth)
  const fallback = rows.filter((r) => r.truth && r.fallback)
  const evaluated = rows.filter((r) => r.truth && !r.fallback)
  // 팀 정확도: 멀티-owner 모듈은 목록 중 누구든 해결자와 일치하면 정답 (owners 미기록 구버전 예측은 owner로 폴백)
  const teamHit = (r) => (r.owners?.length ? r.owners.includes(r.truth) : r.owner === r.truth)
  const correct = evaluated.filter((r) => r.owner === r.truth)
  const teamCorrect = evaluated.filter(teamHit)
  const auto = evaluated.filter((r) => r.confidence > AUTO_MIN && r.category !== 'unknown')
  const autoCorrect = auto.filter((r) => r.owner === r.truth)
  const autoTeamCorrect = auto.filter(teamHit)
  const withLog = evaluated.filter((r) => r.jenkinsLog)
  const withLogCorrect = withLog.filter((r) => r.owner === r.truth)
  const noLog = evaluated.filter((r) => !r.jenkinsLog)
  const noLogCorrect = noLog.filter((r) => r.owner === r.truth)

  console.log(`\n== replay score (${pred}) ==`)
  console.log(`대상 ${preds.length}건 | 정답 없음 ${noTruth.length} | LLM fallback ${fallback.length} | 평가 ${evaluated.length}`)
  console.log(`배정 정확도(owners[0] == 해결자, 제품 그대로): ${correct.length}/${evaluated.length} = ${pct(correct.length, evaluated.length)}`)
  console.log(`팀 정확도(owners 중 해결자 포함):          ${teamCorrect.length}/${evaluated.length} = ${pct(teamCorrect.length, evaluated.length)}`)
  console.log(`잠재 자동 배정률(신뢰도 >${AUTO_MIN}):      ${auto.length}/${evaluated.length} = ${pct(auto.length, evaluated.length)}`)
  console.log(`자동 배정 정밀도(>${AUTO_MIN} 중 정답):     ${autoCorrect.length}/${auto.length} = ${pct(autoCorrect.length, auto.length)} (팀 기준 ${pct(autoTeamCorrect.length, auto.length)})`)
  console.log(`unknown율:                             ${pct(evaluated.filter((r) => r.category === 'unknown').length, evaluated.length)}`)
  console.log(`Jenkins 로그 확보 건 정확도:            ${pct(withLogCorrect.length, withLog.length)} (${withLog.length}건)`)
  console.log(`로그 미확보 건 정확도:                  ${pct(noLogCorrect.length, noLog.length)} (${noLog.length}건)`)
}

/* ── ingest-half — C모드(before/after)용 vault 축적 ───────────────────────── */

// 전반부 티켓을 SVP_WIKI_DIR가 가리키는 vault 복사본에 ingest한다.
// 실행 전제: SVP_WIKI_DIR=<복사본>, SVP_INGEST_MODE=live (아니면 ingest가 로그만 남김).
async function ingestHalf({ half, pred }) {
  const preds = new Map(
    readFileSync(join(DATA_DIR, pred), 'utf-8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l)).map((p) => [p.key, p])
  )
  const targets = halfOf(loadTickets(), half)
  console.log(`[replay] ingest-half: ${targets.length}건 → SVP_WIKI_DIR=${process.env.SVP_WIKI_DIR ?? '(기본 vault!)'} INGEST_MODE=${process.env.SVP_INGEST_MODE ?? 'dry-run'}`)
  for (const t of targets) {
    const p = preds.get(t.key)
    if (!p) {
      console.warn(`[replay] ${t.key}: 예측 없음 (먼저 run --half ${half}) — 건너뜀`)
      continue
    }
    // assignment은 case-log의 assignee 줄에 기록된다 — 운영 vault가 담는 것과 동일하게
    // 실제 해결자(truth)를 넣는다. 분류 프롬프트가 아니라 축적 기록이므로 격리 위반이 아니다.
    const resolver = t.truth.assignee ?? '-'
    const issue = {
      event: t.event,
      classification: { category: p.category, severity: 'major', confidence: p.confidence, summary: '', wikiRefs: [] },
      assignment: { assigneeId: resolver, assigneeName: resolver, routedTo: 'feature-owner', reason: 'replay' }
    }
    await ingestResolved(issue, t.truth.resolvedAt)
    console.log(`[replay] ingested ${t.key} (${p.category})`)
  }
}

/* ── main ─────────────────────────────────────────────────────────────────── */

const cmd = process.argv[2]
const opts = {
  jql: arg('jql'),
  max: Number(arg('max', '200')),
  half: arg('half'),
  out: arg('out', 'predictions.jsonl'),
  pred: arg('pred', 'predictions.jsonl'),
  truthCsv: arg('truth')
}
const commands = {
  collect: () => collect(opts),
  run: () => run(opts),
  score: () => Promise.resolve(score(opts)),
  'ingest-half': () => ingestHalf(opts)
}
if (!commands[cmd]) {
  console.error('usage: node server/replay.mjs <collect|run|score|ingest-half> [--jql|--max|--half|--out|--pred|--truth]')
  process.exit(1)
}
commands[cmd]().catch((err) => {
  console.error(`[replay] ${cmd} failed: ${err.message}`)
  process.exit(1)
})
