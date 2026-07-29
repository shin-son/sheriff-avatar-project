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
  try {
    let jiraRaw = { description: issue.event.log, comments: [] }
    try {
      jiraRaw = await getIssueRaw(key)
    } catch (err) {
      console.error(`[svp-server] ingest ${key}: jira raw fetch failed (${err.message}) — event 원문으로 동결`)
    }
    if (INGEST_MODE !== 'live') {
      console.log(`[svp-server] [${INGEST_MODE}] ingest ${key} (#${n}): would freeze raw/jira/${rawName} + raw/ci, case-log append — vault 변경 안 함`)
      return
    }
    // P0b: LLM reads the raw evidence to fill symptom/cause/resolution.
    const filled = await summarizeResolution(issue.event, { comments: jiraRaw.comments })
    await freezeJiraRaw(rawName, key, issue, jiraRaw, capturedAt)
    await freezeCiRaw(rawName, key, issue, capturedAt)
    await appendCaseLog(issue, capturedAt, filled, n, rawName)
    await appendLog('ingest', `${key}${n > 1 ? ` (재해결 #${n})` : ''} ${issue.event.title}`)
    await rebuildIndex()
    ingestState[key] = { at: resolvedAt ?? capturedAt, n } // 성공 후에만 갱신 (dry-run은 미갱신)
    await saveIngestState()
    console.log(`[svp-server] ingested ${key}${n > 1 ? ` (재해결 #${n}, 이전 supersede)` : ''}: raw/jira/${rawName} + raw/ci 동결, case-log 기록`)
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
