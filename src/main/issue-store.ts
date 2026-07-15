import { readFileSync, writeFileSync } from 'fs'
import type { SheriffIssue } from '@shared/types'

// Persists classified issues so a restarted sheriff app shows its unresolved
// backlog again. The jira dedup store keeps tickets from being re-classified
// after a restart, so without this snapshot the list would come back empty.
// Members don't use this — their state is restored via server:welcome.

export function loadIssueSnapshot(filePath: string): SheriffIssue[] {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as SheriffIssue[]
  } catch {
    // First run or corrupt file: start empty.
    return []
  }
}

/** Resolved issues are pruned here — the snapshot only carries the open backlog. */
export function saveIssueSnapshot(filePath: string, issues: SheriffIssue[]): void {
  writeFileSync(filePath, JSON.stringify(issues.filter((i) => i.status !== 'resolved'), null, 2))
}
