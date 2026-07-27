// Server-side wiki query — port of src/main/modules/wiki/index.ts queryWiki()
// without the Electron dependency. Scores vault notes against a CI event and
// resolves owners from module-note frontmatter (wiki-vault/README.md schema):
// the `owner:` field is the error→module→담당자 mapping the classifier acts on.
// TODO(SVP-8): apply feedback-based demotion once server-side feedback lands.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

const VAULT_DIR =
  process.env.SVP_WIKI_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'wiki-vault')

// Schema/auto-generated files and raw/ originals are not query targets (README.md).
const INFRA_FILES = new Set(['README.md', 'index.md', 'log.md'])

function listMarkdownFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    // 숨김 폴더 제외: 사내 vault에는 .obsidian/, .claude/(스킬) 등이 함께 있다 —
    // 스킬 지침·설정 파일이 wiki 노트로 검색되어 분류 프롬프트에 섞이면 안 된다.
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name !== 'raw') out.push(...listMarkdownFiles(full))
    } else if (name.endsWith('.md') && !INFRA_FILES.has(name)) {
      out.push(full)
    }
  }
  return out
}

/** Minimal frontmatter reader: `key: value` lines between the two --- fences. */
function parseFrontmatter(content) {
  const fields = {}
  const lines = content.split('\n')
  if (lines[0]?.trim() !== '---') return fields
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') break
    const sep = lines[i].indexOf(': ')
    if (sep > 0) fields[lines[i].slice(0, sep).trim()] = lines[i].slice(sep + 2).trim()
  }
  return fields
}

function toTitle(file, content) {
  const heading = content.split('\n').find((l) => l.startsWith('# '))
  return heading ? heading.slice(2).trim() : basename(file, '.md')
}

/** All module notes: [{module, owner, file}] — source of the category enum and owner map. */
export function listModules() {
  const modulesDir = join(VAULT_DIR, 'modules')
  const out = []
  try {
    for (const name of readdirSync(modulesDir)) {
      if (!name.endsWith('.md')) continue
      const fm = parseFrontmatter(readFileSync(join(modulesDir, name), 'utf-8'))
      if (fm.module && fm.owner) out.push({ module: fm.module, owner: fm.owner, file: `modules/${name}` })
    }
  } catch {
    // no vault / no modules dir: classifier will run with an empty enum → unknown only
  }
  return out
}

/** Owner (= Jira username) for a classified category, from note frontmatter only. */
export function resolveOwner(category) {
  return listModules().find((m) => m.module === category)?.owner ?? null
}

/**
 * Catalog of all queryable notes for LLM note selection (SVP-3 drill-down):
 * one entry per note — file/title/module/tags, no bodies. index.md가 아니라
 * 파일에서 직접 만든다 (index에는 tags·module이 없고, 갱신 시점에 의존하지 않음).
 */
export function listCatalog() {
  let files = []
  try {
    files = listMarkdownFiles(VAULT_DIR)
  } catch {
    return []
  }
  return files.map((file) => {
    const content = readFileSync(file, 'utf-8')
    const fm = parseFrontmatter(content)
    return {
      file: relative(VAULT_DIR, file).replaceAll('\\', '/'),
      title: toTitle(file, content),
      module: fm.module ?? null,
      tags: (fm.tags ?? '').replace(/[[\]]/g, '')
    }
  })
}

/** Full match objects for catalog-relative paths; unreadable paths are dropped. */
export function readNotes(files) {
  const out = []
  for (const file of files) {
    try {
      const content = readFileSync(join(VAULT_DIR, file), 'utf-8')
      const fm = parseFrontmatter(content)
      out.push({
        file,
        title: toTitle(file, content),
        score: 0, // LLM-picked, not keyword-scored
        body: content,
        module: fm.module ?? null,
        owner: fm.owner ?? null
      })
    } catch {
      // stale/invalid path from the selection step — skip
    }
  }
  return out
}

/**
 * Note-side signals matched against the ticket text: frontmatter tags +
 * identifier-like tokens (≥5 chars) from known-failure headings and symptom
 * lines — the verbatim test names/error strings the vault schema requires
 * notes to keep (README.md "실패한 테스트 이름과 에러 문자열은 원문 그대로").
 */
function noteSignals(content, fm) {
  const signals = new Set()
  for (const tag of (fm.tags ?? '').replace(/[[\]]/g, '').split(',')) {
    const t = tag.trim().toLowerCase()
    if (t.length > 1) signals.add(t)
  }
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*(?:###\s+(.*)|-\s*symptom\s*:\s*(.*))/i)
    if (!m) continue
    for (const token of (m[1] ?? m[2]).match(/[A-Za-z][\w.-]{4,}/g) ?? []) {
      signals.add(token.toLowerCase())
    }
  }
  return signals
}

/**
 * 초도분석 scorer — two directions:
 *  - event → note (Electron adapter behavior): keywords = module + title words
 *    >3 chars; module match +3, other keyword substring +1.
 *  - note → event: noteSignals() found in the ticket text (title + description
 *    + Jenkins failure log) +2 each — description/로그가 제목보다 실측 신호가
 *    많으므로 known-failure 원문이 로그에 그대로 찍힌 노트가 위로 온다.
 * Top 3 with score > 0. Returns matches extended with body/module/owner so
 * the classifier can build its prompt without re-reading files.
 */
export function queryWiki(event) {
  const keywords = new Set(
    [event.module, ...event.title.toLowerCase().split(/[^a-z0-9가-힣_.-]+/)].filter(
      (w) => w && w.length > 3
    )
  )
  const ticketText = `${event.title}\n${event.log ?? ''}`.toLowerCase()
  const matches = []
  let files = []
  try {
    files = listMarkdownFiles(VAULT_DIR)
  } catch {
    return []
  }
  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    const fm = parseFrontmatter(content)
    const haystack = content.toLowerCase()
    let score = 0
    for (const keyword of keywords) {
      if (!haystack.includes(keyword)) continue
      score += keyword === event.module ? 3 : 1
    }
    for (const signal of noteSignals(content, fm)) {
      if (ticketText.includes(signal)) score += 2
    }
    if (score > 0) {
      matches.push({
        file: relative(VAULT_DIR, file).replaceAll('\\', '/'),
        title: toTitle(file, content),
        score,
        body: content,
        module: fm.module ?? null,
        owner: fm.owner ?? null
      })
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 3)
}

// TC name(e.g. "linux.power-cmu-110.sh") → Gerrit file path("linux/power-cmu-110.sh").
// Only the first dot is treated as a directory separator — the rest of the name is kept.
function tcNameToPath(tcName) {
  const dot = tcName.indexOf('.')
  if (dot < 0) return tcName
  return tcName.slice(0, dot) + '/' + tcName.slice(dot + 1)
}

function runClaude(args, timeoutMs) {
  return new Promise((resolve) => {
    execFile('claude', args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (stdout ?? '').trim(), err: (stderr ?? '').trim() })
    })
  })
}

/**
 * Gerrit lookup via headless claude -p (same pattern as comment-channel.mjs).
 * Returns the committer id and display info from the most recent CL touching the file.
 * Returns null when the lookup fails or no CL is found.
 */
async function lookupGerritCommitter(filePath) {
  const MCP = 'Exynos-Auto-CICD-Gerrit'
  const prompt =
    `Use the ${MCP} MCP tool query_changes to find the most recent merged change that touched the file path "${filePath}". ` +
    `Reply with EXACTLY ONE JSON object: {"changeId":"<CL number>","owner":"<owner email or username>","name":"<owner display name>"}. ` +
    `If no change is found reply with {"changeId":"","owner":"","name":""}. No prose, no code fences.`
  const { ok, out } = await runClaude(
    ['-p', prompt, '--allowedTools', `mcp__${MCP}__query_changes,mcp__${MCP}__get_change_details`, '--output-format', 'text'],
    60_000
  )
  if (!ok || !out) return null
  try {
    const start = out.indexOf('{')
    const end = out.lastIndexOf('}')
    if (start < 0 || end < 0) return null
    const parsed = JSON.parse(out.slice(start, end + 1))
    if (!parsed.owner) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Build a ranked candidate list for human-in-the-loop assignee selection.
 * Currently sources: Gerrit (last committer on the TC file) + wiki (module owner).
 * Returned list has Gerrit candidates first (highest signal), wiki second.
 */
export async function buildCandidates(event) {
  const candidates = []

  // ── Gerrit: TC name → file path → last committer ─────────────────────────
  const tcMatch = (event.log ?? '').match(/TC\s+name\s*(?:or\s+file)?\s*:\s*(\S+)/i)
  if (tcMatch) {
    const tcName = tcMatch[1]
    const filePath = tcNameToPath(tcName)
    try {
      const result = await lookupGerritCommitter(filePath)
      if (result?.owner) {
        candidates.push({
          id: result.owner,
          name: result.name || result.owner,
          source: 'gerrit',
          reason: result.changeId
            ? `Gerrit CL ${result.changeId} — ${filePath} 마지막 커미터`
            : `Gerrit — ${filePath} 마지막 커미터`
        })
      }
    } catch (err) {
      console.warn(`[svp-server] buildCandidates gerrit lookup failed: ${err.message}`)
    }
  }

  // ── Wiki: module owner from frontmatter ──────────────────────────────────
  const category =
    event.module && event.module !== 'unknown' ? event.module : null
  if (category) {
    const owner = resolveOwner(category)
    if (owner && !candidates.some((c) => c.id === owner)) {
      candidates.push({
        id: owner,
        name: owner,
        source: 'wiki',
        reason: `LLM-WIKI ${category} 모듈 담당자`
      })
    }
  }

  return candidates
}
