// F7 — ingest a resolved issue back into the vault. This is the sink the
// polling loop was missing: on a ticket's transition into `resolved`, freeze the
// raw evidence (raw/jira, raw/ci), have the LLM fill the case-log symptom/cause/
// resolution from that evidence, then refresh index.md/log.md. Mirrors
// src/main/modules/wiki/index.ts ingest/index/log, minus Electron, plus the
// multi-source raw schema (wiki-vault/README.md).
//
// Scope note: raw/gerrit is written only when a Change-Id is supplied; the
// Gerrit fetch is a later source adapter. Without LLM credentials the case-log
// symptom is still captured (summarizeResolution fallback), cause/resolution 불명.
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { appendFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { summarizeResolution } from './classifier.mjs'
import { getIssueRaw } from './jira.mjs'

const VAULT_DIR =
  process.env.SVP_WIKI_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'wiki-vault')
// dry-run(기본) → 로그만, vault 파일 안 건드림 | live → 실제 동결.
// WRITE_MODE(Jira write)와 같은 안전 철학: 테스트 중 vault 오염 방지.
export const INGEST_MODE = process.env.SVP_INGEST_MODE ?? 'dry-run'
const INFRA_FILES = new Set(['README.md', 'index.md', 'log.md'])

// 해결 이벤트 단위 멱등성 상태: { <jira key>: { at: <resolvedAt ISO>, n: <재기록 횟수> } }.
// raw/jira/ 아래 숨김 파일 — listNoteFiles가 raw·`.` 시작을 제외하므로 index에 안 걸린다.
// reopen 후 재해결 시 '더 늦은 resolvedAt'만 재기록하고, 재시작·중복 폴링(같은 resolvedAt)은
// 스킵해 중복 기록을 막는다 (raw 불변 원칙은 버전 파일 raw/jira/<key>-r<n>.md로 유지).
const INGEST_STATE_FILE = join(VAULT_DIR, 'raw', 'jira', '.ingest-state.json')
const ingestState = loadIngestState()

function loadIngestState() {
  try {
    return JSON.parse(readFileSync(INGEST_STATE_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function saveIngestState() {
  mkdirSync(dirname(INGEST_STATE_FILE), { recursive: true })
  return writeFile(INGEST_STATE_FILE, JSON.stringify(ingestState, null, 2), 'utf-8')
}

/**
 * 이 resolve 이벤트를 ingest할지 결정 (순수 함수 — 테스트 대상).
 * 첫 해결은 항상 기록(n=1), reopen 후 더 늦은 resolvedAt이면 재기록(n+1),
 * 같은/이전 resolvedAt(재시작·중복 폴링)이나 resolvedAt 부재 시 prev 있으면 스킵.
 */
export function decideIngest(prev, resolvedAt) {
  if (!prev) return { skip: false, n: 1 }
  if (!resolvedAt || prev.at >= resolvedAt) return { skip: true, n: prev.n }
  return { skip: false, n: prev.n + 1 }
}

// ── D: 중복 티켓 dedup (backend 위생) ───────────────────────────────────────
// 서로 다른 티켓이 같은 실패 서명이면 case-log '지식'은 하나(anchor)로 유지하고
// 나머지는 포인터 + 재발 카운트만 남긴다(LLM summarize 호출도 스킵). raw 증거는
// 티켓마다 보존한다. 상태: { <signature>: { anchorKey, module, count, tickets[], lastAt } }.
const SIGNATURE_INDEX_FILE = join(VAULT_DIR, 'raw', 'jira', '.signature-index.json')
const sigIndex = loadSigIndex()
// 오탐(flaky·별개 회귀) 방지: 같은 모듈 + 이 기간 내에서만 재발로 묶는다. 기본 14일.
const DEDUP_WINDOW_MS = Number(process.env.SVP_DEDUP_WINDOW_DAYS ?? 14) * 24 * 60 * 60 * 1000

function loadSigIndex() {
  try {
    return JSON.parse(readFileSync(SIGNATURE_INDEX_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function saveSigIndex() {
  mkdirSync(dirname(SIGNATURE_INDEX_FILE), { recursive: true })
  return writeFile(SIGNATURE_INDEX_FILE, JSON.stringify(sigIndex, null, 2), 'utf-8')
}

/** 실패 서명 — 로그의 'TC name or file' 우선, 없으면 제목 정규화([..] 접두·Failed 접미 제거). */
export function signatureOf(event) {
  const m = (event.log ?? '').match(/TC name or file\s*:\s*(\S+)/i)
  if (m) return m[1].toLowerCase()
  return (event.title ?? '')
    .replace(/^(\[[^\]]*\]\s*)+/g, '')
    .replace(/^[\s:|-]+/, '')
    .replace(/\s*[:|-]?\s*(failed|fail)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * 이 해결이 '다른 티켓의 재발(추정)'인지 판정 (순수 함수 — 테스트 대상).
 * 첫 해결(n===1)만, 다른 anchor, 같은 모듈, 시간창 내일 때만 재발로 본다.
 * reopen 재해결(n>1)은 #40이 supersede로 처리하므로 여기 대상이 아니다.
 */
export function isDuplicateRecurrence(prevSig, { key, module, at, n }, windowMs) {
  if (n !== 1 || !prevSig || !at) return false
  if (prevSig.anchorKey === key) return false
  if (prevSig.module !== module) return false
  return new Date(at).getTime() - new Date(prevSig.lastAt).getTime() <= windowMs
}

/**
 * ingest 모드 결정 (순수 함수 — 테스트 대상). 순서가 중요하다:
 *  - 'anchor-reresolve' : anchor 티켓의 재해결 → supersede 풀 엔트리, 카운트 유지.
 *  - 'member-reresolve' : 이미 dedup된 비-anchor 티켓의 재해결 → 포인터, 카운트 유지,
 *    **재anchor 금지**(이 분기가 없으면 anchor가 뒤집히고 재발 이력이 소실됐다).
 *  - 'recurrence'       : 새 중복 티켓(같은 서명·모듈·창 내) → 포인터, 카운트+1.
 *  - 'full'             : 신규 서명 / 창 만료 새 티켓 → 풀 엔트리 + 새 anchor.
 */
export function classifyIngest(prevSig, { key, module, at, n }, windowMs) {
  if (!prevSig) return 'full'
  if (prevSig.anchorKey === key) return 'anchor-reresolve'
  if ((prevSig.tickets ?? []).includes(key)) return 'member-reresolve'
  if (isDuplicateRecurrence(prevSig, { key, module, at, n }, windowMs)) return 'recurrence'
  return 'full'
}

/**
 * File a resolved issue: freeze raw evidence → append case-log → refresh
 * index/log. Fire-and-forget from the poll loop; never throws into it.
 * `resolvedAt`(Jira updated 시각)로 해결 이벤트 단위 멱등성을 판정 — reopen 후
 * 재해결은 버전 raw + supersede 표식으로 안전하게 재기록한다.
 */
export async function ingestResolved(issue, resolvedAt) {
  const key = issue.event.jira.key
  const decision = decideIngest(ingestState[key], resolvedAt)
  if (decision.skip) return
  const n = decision.n
  const rawName = n === 1 ? key : `${key}-r${n}` // 불변 raw 보존: 재해결은 새 파일로
  const capturedAt = new Date().toISOString()
  const at = resolvedAt ?? capturedAt
  const sig = signatureOf(issue.event)
  const moduleCat = issue.classification.category
  const prevSig = sigIndex[sig]
  const mode = classifyIngest(prevSig, { key, module: moduleCat, at, n }, DEDUP_WINDOW_MS)
  const pointer = mode === 'recurrence' || mode === 'member-reresolve'
  try {
    let jiraRaw = { description: issue.event.log, comments: [] }
    try {
      jiraRaw = await getIssueRaw(key)
    } catch (err) {
      console.error(`[svp-server] ingest ${key}: jira raw fetch failed (${err.message}) — event 원문으로 동결`)
    }
    if (INGEST_MODE !== 'live') {
      const how = pointer
        ? `${mode === 'recurrence' ? '재발(추정)' : '재해결'} → ${prevSig.anchorKey} 포인터, summarize 스킵`
        : `raw/jira/${rawName} + raw/ci, case-log append`
      console.log(`[svp-server] [${INGEST_MODE}] ingest ${key} (#${n}): would ${how} — vault 변경 안 함`)
      return
    }
    // raw 증거는 재발이어도 티켓마다 동결한다 (dedup은 case-log 지식층만).
    await freezeJiraRaw(rawName, key, issue, jiraRaw, capturedAt)
    await freezeCiRaw(rawName, key, issue, capturedAt)
    if (pointer) {
      // 포인터 경로 — recurrence는 새 중복(count+1·티켓 추가), member-reresolve는
      // 이미 dedup된 티켓의 재해결(count·anchor·tickets 유지 — 재anchor 금지).
      const isRec = mode === 'recurrence'
      const relation = isRec ? '재발(추정)' : '재해결'
      const count = isRec ? prevSig.count + 1 : prevSig.count
      await appendCaseLogPointer(issue, capturedAt, prevSig.anchorKey, count, rawName, relation)
      await appendLog('ingest', `${key} ${relation} → ${prevSig.anchorKey} (누적 ${count}건)`)
      sigIndex[sig] = {
        ...prevSig,
        count,
        tickets: isRec ? [...prevSig.tickets, key] : prevSig.tickets,
        lastAt: at
      }
      console.log(`[svp-server] deduped ${key}: ${relation} → ${prevSig.anchorKey} (누적 ${count}건), summarize 스킵`)
    } else {
      // 'full'(신규 서명·창 만료) / 'anchor-reresolve'(anchor 재해결) → 풀 엔트리.
      const filled = await summarizeResolution(issue.event, { comments: jiraRaw.comments })
      await appendCaseLog(issue, capturedAt, filled, n, rawName)
      await appendLog('ingest', `${key}${n > 1 ? ` (재해결 #${n})` : ''} ${issue.event.title}`)
      sigIndex[sig] =
        mode === 'anchor-reresolve'
          ? { ...prevSig, lastAt: at } // anchor 재해결(reopen): 카운트 유지
          : { anchorKey: key, module: moduleCat, count: 1, tickets: [key], lastAt: at }
      console.log(`[svp-server] ingested ${key}${n > 1 ? ` (재해결 #${n}, 이전 supersede)` : ''}: raw/jira/${rawName} + raw/ci 동결, case-log 기록`)
    }
    await rebuildIndex()
    ingestState[key] = { at, n } // 성공 후에만 갱신 (dry-run은 미갱신)
    await Promise.all([saveIngestState(), saveSigIndex()])
  } catch (err) {
    console.error(`[svp-server] ingest failed for ${key}: ${err.message}`)
  }
}

/* ── raw 동결 (immutable, 티켓/빌드/Change당 1회) ───────────────────────── */

function writeRaw(source, name, body) {
  const dir = join(VAULT_DIR, 'raw', source)
  mkdirSync(dir, { recursive: true })
  return writeFile(join(dir, `${name}.md`), body, 'utf-8')
}

function freezeJiraRaw(rawName, key, issue, { description, comments }, capturedAt) {
  const body = [
    '---',
    'type: raw',
    'source: jira',
    `jira: ${key}`,
    `ci-build: ${key}`, // P0a: build-id 부재 → jira 키 대체 (raw correlation key)
    `captured: ${capturedAt}`,
    '---',
    '',
    `# ${key} — ${issue.event.title}`,
    '',
    '## Description',
    description || '(없음)',
    '',
    '## Resolution comments',
    comments.length ? comments.join('\n\n') : '(없음)',
    ''
  ].join('\n')
  return writeRaw('jira', rawName, body)
}

function freezeCiRaw(rawName, key, issue, capturedAt) {
  const body = [
    '---',
    'type: raw',
    'source: ci',
    `build: ${key}`, // P0a: jira 키 대체
    `jira: ${key}`,
    `module: ${issue.event.module}`,
    `captured: ${capturedAt}`,
    '---',
    '',
    `# ${key} — ${issue.event.type}`,
    '',
    '## Failed tests',
    issue.event.title,
    '',
    '## Log excerpt',
    issue.event.log || '(없음)',
    ''
  ].join('\n')
  return writeRaw('ci', rawName, body)
}

/* ── case-log / index.md / log.md ───────────────────────────────────────── */

function appendCaseLog(issue, capturedAt, filled, n, rawName) {
  const key = issue.event.jira.key
  const refs = issue.classification.wikiRefs?.length
    ? issue.classification.wikiRefs.map((r) => r.title).join(', ')
    : '(없음)'
  // symptom/cause/resolution: LLM(summarizeResolution)이 raw를 읽어 채운다 (P0b).
  // 자격증명 없으면 fallback으로 symptom만 채워진 채 들어온다.
  const entry = [
    `\n## ${issue.event.id} — ${issue.event.title}${n > 1 ? ` (재해결 #${n})` : ''}`,
    // 재해결(reopen 후): 이전 기록을 대체함을 명시 — query/lint가 교정본을 우선하게 한다.
    ...(n > 1 ? [`- note: reopen 후 재해결 (재기록 #${n}, 이전 기록 supersede)`] : []),
    `- date: ${capturedAt}`,
    `- module: ${issue.classification.category}`,
    `- type: ${issue.event.type}`,
    `- confidence: ${issue.classification.confidence}`,
    `- assignee: ${issue.assignment.assigneeName} (${issue.assignment.routedTo})`,
    `- jira: ${key} — 원문 사본은 raw/jira/${rawName}.md`,
    `- ci-build: ${key} — 원문 사본은 raw/ci/${rawName}.md`,
    `- symptom: ${filled.symptom}`,
    `- cause: ${filled.cause}`,
    `- resolution: ${filled.resolution}`,
    `- wiki-refs: ${refs}`,
    ''
  ].join('\n')
  return appendFile(join(VAULT_DIR, 'case-log.md'), entry, 'utf-8')
}

/** D: 포인터 엔트리 — 풀 지식(symptom/cause/resolution)은 anchor에 있고, 여기엔 링크·카운트만. */
function appendCaseLogPointer(issue, capturedAt, anchorKey, count, rawName, relation = '재발 추정') {
  const key = issue.event.jira.key
  const entry = [
    `\n## ${issue.event.id} — ${issue.event.title} (${relation} → ${anchorKey}, 누적 ${count}건)`,
    `- date: ${capturedAt}`,
    `- module: ${issue.classification.category}`,
    `- type: ${issue.event.type}`,
    `- jira: ${key} — 원문 사본은 raw/jira/${rawName}.md`,
    `- ci-build: ${key} — 원문 사본은 raw/ci/${rawName}.md`,
    `- ref: 해결 근거는 ${anchorKey} 참조 (같은 실패 서명 — 병합은 당번이 Jira에서 확인)`,
    ''
  ].join('\n')
  return appendFile(join(VAULT_DIR, 'case-log.md'), entry, 'utf-8')
}

function appendLog(op, detail) {
  const line = `\n## [${new Date().toISOString().slice(0, 10)}] ${op} | ${detail}\n`
  return appendFile(join(VAULT_DIR, 'log.md'), line, 'utf-8')
}

/** Knowledge notes only: raw/ and infra files are not index targets (README.md). */
function listNoteFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    // 숨김 폴더 제외: 사내 vault에는 .obsidian/, .claude/(스킬) 등이 함께 있다 —
    // index.md 카탈로그에 스킬·설정 파일이 노트로 등재되면 안 된다.
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name !== 'raw') out.push(...listNoteFiles(full))
    } else if (name.endsWith('.md') && !INFRA_FILES.has(name)) {
      out.push(full)
    }
  }
  return out
}

async function rebuildIndex() {
  const lines = [
    '# Index',
    '',
    '쿼리 시 가장 먼저 읽는 카탈로그. ingest/lint 시 자동 갱신되므로 수동 편집 금지.',
    ''
  ]
  for (const file of listNoteFiles(VAULT_DIR)) {
    const title = relative(VAULT_DIR, file).replaceAll('\\', '/')
    const content = readFileSync(file, 'utf-8')
    const heading = content.split('\n').find((l) => l.startsWith('# '))?.slice(2).trim() ?? title
    lines.push(`- [${title}](${title}) — ${heading}`)
  }
  lines.push('')
  await writeFile(join(VAULT_DIR, 'index.md'), lines.join('\n'), 'utf-8')
}
