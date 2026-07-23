// Issue cache — persists each ticket's 초도분석 result (Jenkins-enriched
// log/url + LLM classification) across server restarts, so an already-analyzed
// ticket is never re-fetched, re-classified, or re-toasted (poll() re-pushes it
// with restored: true). Jira stays the source of truth for status/assignee —
// losing this file only costs a re-analysis, never correctness.
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CACHE_FILE = join(dirname(fileURLToPath(import.meta.url)), 'issue-cache.json')

/** @returns Map of key → { receivedAt, log, url, classification? } */
export function loadIssueCache() {
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(CACHE_FILE, 'utf-8'))))
  } catch {
    return new Map() // no file yet (or unreadable) — start empty, tickets just re-analyze
  }
}

// Saves are fire-and-forget from the poll loop and classifyAndAct — serialize
// them so overlapping writeFile calls can't interleave into corrupt JSON.
let lastWrite = Promise.resolve()

export function saveIssueCache(cache) {
  const body = JSON.stringify(Object.fromEntries(cache), null, 2)
  lastWrite = lastWrite
    .then(() => writeFile(CACHE_FILE, body, 'utf-8'))
    .catch((err) => console.error(`[svp-server] issue-cache save failed: ${err.message}`))
}
