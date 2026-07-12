import { appendFile, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import type { CIEvent, SheriffIssue, WikiMatch } from '@shared/types'

function vaultDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'wiki-vault')
    : join(app.getAppPath(), 'wiki-vault')
}

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

/** Naive keyword search over the vault. TODO(SVP-3): replace with embeddings/RAG. */
export async function findRelatedNotes(event: CIEvent): Promise<WikiMatch[]> {
  const keywords = [
    event.module,
    ...event.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3)
  ]
  try {
    const root = vaultDir()
    const files = await listMarkdownFiles(root)
    const matches: WikiMatch[] = []
    for (const file of files) {
      const content = (await readFile(file, 'utf-8')).toLowerCase()
      let score = 0
      for (const kw of keywords) {
        if (kw && content.includes(kw.toLowerCase())) score += kw === event.module ? 3 : 1
      }
      if (score > 0) {
        matches.push({ file, title: file.slice(root.length + 1).replace(/\\/g, '/'), score })
      }
    }
    return matches.sort((a, b) => b.score - a.score).slice(0, 3)
  } catch (err) {
    console.error('[svp:wiki] vault scan failed', err)
    return []
  }
}

/**
 * Records how an issue was handled. These entries feed back into
 * findRelatedNotes(), closing the llm-wiki loop: resolved cases raise the
 * classifier's confidence for similar future issues.
 */
export async function appendCaseLog(issue: SheriffIssue): Promise<void> {
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
  } catch (err) {
    console.error('[svp:wiki] case log append failed', err)
  }
}
