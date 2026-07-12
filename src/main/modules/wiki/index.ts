import { existsSync, readFileSync, writeFileSync } from 'fs'
import { appendFile, readFile, readdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import type { CIEvent, SheriffIssue, WikiLintReport, WikiMatch } from '@shared/types'

/**
 * LLM-WIKI adapter. Implements the four core operations of the llm-wiki
 * pattern (docs/llm-wiki-concept.md):
 *   query    — find notes relevant to a CI event (used by the classifier)
 *   ingest   — file a resolved issue back into the wiki (case-log + log + index)
 *   lint     — health-check: orphan notes, negative-feedback notes
 *   feedback — 👍/👎 votes on note usefulness; the loop that keeps junk out
 */

function vaultDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'wiki-vault')
    : join(app.getAppPath(), 'wiki-vault')
}

/** Infrastructure files: never matched by query, never counted as knowledge notes. */
const INFRA_FILES = new Set(['README.md', 'index.md', 'log.md'])

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await listMarkdownFiles(full)))
    else if (entry.name.endsWith('.md')) files.push(full)
  }
  return files
}

function toTitle(file: string, root: string): string {
  return file.slice(root.length + 1).replace(/\\/g, '/')
}

/* ── feedback ─────────────────────────────────────────────────────────── */

interface FeedbackEntry {
  up: number
  down: number
}

// Runtime data per user, so it lives in userData rather than the vault
// (the vault is read-only resources in a packaged app).
function feedbackPath(): string {
  return join(app.getPath('userData'), 'svp-wiki-feedback.json')
}

function loadFeedback(): Record<string, FeedbackEntry> {
  try {
    if (existsSync(feedbackPath())) {
      return JSON.parse(readFileSync(feedbackPath(), 'utf-8')) as Record<string, FeedbackEntry>
    }
  } catch {
    // corrupted store: start fresh
  }
  return {}
}

export function recordFeedback(noteTitle: string, helpful: boolean): void {
  const fb = loadFeedback()
  const entry = fb[noteTitle] ?? { up: 0, down: 0 }
  if (helpful) entry.up += 1
  else entry.down += 1
  fb[noteTitle] = entry
  writeFileSync(feedbackPath(), JSON.stringify(fb, null, 2))
}

function isUnhelpful(title: string, fb: Record<string, FeedbackEntry>): boolean {
  const entry = fb[title]
  return !!entry && entry.down >= 3 && entry.down > entry.up
}

/* ── query ────────────────────────────────────────────────────────────── */

/** Naive keyword search over the vault. TODO(SVP-3): replace with embeddings/RAG. */
export async function queryWiki(event: CIEvent): Promise<WikiMatch[]> {
  const keywords = [
    event.module,
    ...event.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3)
  ]
  try {
    const root = vaultDir()
    const files = await listMarkdownFiles(root)
    const fb = loadFeedback()
    const matches: WikiMatch[] = []
    for (const file of files) {
      const title = toTitle(file, root)
      if (INFRA_FILES.has(title)) continue
      const content = (await readFile(file, 'utf-8')).toLowerCase()
      let score = 0
      for (const kw of keywords) {
        if (kw && content.includes(kw.toLowerCase())) score += kw === event.module ? 3 : 1
      }
      // Feedback loop: notes voted unhelpful lose half their score, which in
      // turn lowers the classifier's confidence in them.
      if (isUnhelpful(title, fb)) score = Math.floor(score / 2)
      if (score > 0) matches.push({ file, title, score })
    }
    return matches.sort((a, b) => b.score - a.score).slice(0, 3)
  } catch (err) {
    console.error('[svp:wiki] query failed', err)
    return []
  }
}

/* ── ingest ───────────────────────────────────────────────────────────── */

/**
 * Files a resolved issue back into the wiki. These entries feed query(),
 * closing the llm-wiki loop: resolved cases raise the classifier's
 * confidence for similar future issues.
 * TODO(SVP-4): use the LLM to also draft a known-failure note update.
 */
export async function ingestResolvedIssue(issue: SheriffIssue): Promise<void> {
  const entry = [
    `\n## ${issue.event.id} — ${issue.event.title}`,
    `- date: ${issue.receivedAt}`,
    `- module: ${issue.classification.category}`,
    `- type: ${issue.event.type}`,
    `- confidence: ${issue.classification.confidence}`,
    `- assignee: ${issue.assignment.assigneeName} (${issue.assignment.routedTo})`,
    `- resolution: resolved via Sheriff Avatar app`,
    ''
  ].join('\n')
  try {
    await appendFile(join(vaultDir(), 'case-log.md'), entry, 'utf-8')
    await appendLog('ingest', `${issue.event.id} ${issue.event.title}`)
    await rebuildIndex()
  } catch (err) {
    console.error('[svp:wiki] ingest failed', err)
  }
}

/* ── lint ─────────────────────────────────────────────────────────────── */

export async function lintWiki(): Promise<WikiLintReport> {
  const root = vaultDir()
  const files = await listMarkdownFiles(root)
  const contents = new Map<string, string>()
  for (const file of files) {
    contents.set(toTitle(file, root), await readFile(file, 'utf-8'))
  }
  const notes = [...contents.keys()].filter((t) => !INFRA_FILES.has(t))
  const fb = loadFeedback()

  // Orphan: no other file (including README/index) mentions this note.
  const orphanNotes = notes.filter((title) => {
    const name = title.split('/').pop() as string
    return ![...contents.entries()].some(([other, body]) => other !== title && body.includes(name))
  })
  const unhelpfulNotes = notes.filter((t) => isUnhelpful(t, fb))

  const suggestions = [
    ...orphanNotes.map((t) => `『${t}』를 참조하는 노트가 없음 — 관련 노트에서 링크하거나 통합을 검토할 것`),
    ...unhelpfulNotes.map((t) => `『${t}』에 부정 피드백 누적 — 내용을 재검토하고 수정 또는 삭제할 것`)
  ]

  try {
    await appendLog('lint', `notes=${notes.length} orphans=${orphanNotes.length} unhelpful=${unhelpfulNotes.length}`)
    await rebuildIndex()
  } catch (err) {
    console.error('[svp:wiki] lint bookkeeping failed', err)
  }

  return {
    generatedAt: new Date().toISOString(),
    noteCount: notes.length,
    orphanNotes,
    unhelpfulNotes,
    suggestions
  }
}

/* ── index.md / log.md bookkeeping ────────────────────────────────────── */

async function appendLog(op: string, detail: string): Promise<void> {
  const line = `\n## [${new Date().toISOString().slice(0, 10)}] ${op} | ${detail}\n`
  await appendFile(join(vaultDir(), 'log.md'), line, 'utf-8')
}

/** Regenerates index.md: one line per note with its first heading as summary. */
async function rebuildIndex(): Promise<void> {
  const root = vaultDir()
  const files = await listMarkdownFiles(root)
  const lines = [
    '# Index',
    '',
    '쿼리 시 가장 먼저 읽는 카탈로그. ingest/lint 시 자동 갱신되므로 수동 편집 금지.',
    ''
  ]
  for (const file of files) {
    const title = toTitle(file, root)
    if (INFRA_FILES.has(title)) continue
    const content = await readFile(file, 'utf-8')
    const heading = content.split('\n').find((l) => l.startsWith('# '))?.slice(2).trim() ?? title
    lines.push(`- [${title}](${title}) — ${heading}`)
  }
  lines.push('')
  await writeFile(join(root, 'index.md'), lines.join('\n'), 'utf-8')
}
