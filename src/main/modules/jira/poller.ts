import type { CIEvent, CIEventType, JiraTicketRef } from '@shared/types'
import { ProcessedTicketStore } from './store'

export interface JiraPollerOptions {
  baseUrl: string
  project: string
  label: string
  /**
   * Overrides the default `project = X AND labels = Y` filter when the team's CI
   * tickets are identified differently (e.g. by component/assignee). The poller
   * appends the created-time bound and ordering. Keep the actual corporate value
   * in env only — never in the repo.
   */
  jql?: string
  pollMs: number
  pat?: string
  /** Path of the processed-ticket dedup store (JSON, under userData). */
  storePath: string
}

interface JiraIssue {
  key: string
  fields: {
    summary: string
    description: string | null
    created: string
    status: { statusCategory: { key: string } }
  }
}

const MAX_BACKOFF_MS = 5 * 60 * 1000
const EVENT_TYPES: readonly CIEventType[] = ['test_failed', 'build_failed', 'lint_failed', 'deploy_failed']

/** JQL takes minute precision; the resulting overlap re-fetch is absorbed by the dedup store. */
function toJqlMinute(iso: string): string {
  const d = new Date(iso)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * Parses the ticket description into CIEvent fields. Line-oriented `key: value`
 * header followed by `log:` and the raw log — the contract mock/jira-server.mjs
 * writes. TODO(SVP-6): replace with the real corporate ticket schema once confirmed.
 */
export function normalizeTicket(issue: JiraIssue, browseUrl: string): CIEvent {
  const lines = (issue.fields.description ?? '').split('\n')
  const fields: Record<string, string> = {}
  let log = ''
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === 'log:') {
      log = lines.slice(i + 1).join('\n')
      break
    }
    const sep = lines[i].indexOf(': ')
    if (sep > 0) fields[lines[i].slice(0, sep)] = lines[i].slice(sep + 2)
  }
  const type = EVENT_TYPES.find((t) => t === fields['type']) ?? 'test_failed'
  const jira: JiraTicketRef = {
    key: issue.key,
    url: browseUrl,
    status: issue.fields.status.statusCategory.key
  }
  return {
    id: issue.key,
    type,
    title: issue.fields.summary,
    module: fields['module'] ?? 'unknown',
    branch: fields['branch'] ?? '',
    log: log || (issue.fields.description ?? ''),
    url: fields['ci-url'] ?? browseUrl,
    timestamp: issue.fields.created,
    source: 'jira',
    jira
  }
}

/**
 * F1 — polls Jira for new ci-failure tickets and feeds them into the pipeline
 * as normalized CIEvents. Exactly-once via ProcessedTicketStore; exponential
 * backoff while Jira is down, catching up through `created >= lastPoll` after
 * recovery.
 */
export class JiraPoller {
  private readonly store: ProcessedTicketStore
  private timer: NodeJS.Timeout | null = null
  private failures = 0
  private disposed = false

  constructor(
    private readonly opts: JiraPollerOptions,
    private readonly onEvent: (event: CIEvent) => void
  ) {
    this.store = new ProcessedTicketStore(opts.storePath)
  }

  start(): void {
    console.log(`[svp:jira] polling ${this.opts.baseUrl} every ${this.opts.pollMs}ms`)
    void this.poll()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
  }

  private async poll(): Promise<void> {
    const cycleStart = new Date().toISOString()
    try {
      const issues = await this.fetchNewTickets()
      for (const issue of issues) {
        if (this.store.has(issue.key)) continue
        this.onEvent(normalizeTicket(issue, `${this.opts.baseUrl}/browse/${issue.key}`))
        this.store.markProcessed(issue.key)
        console.log(`[svp:jira] new ticket ${issue.key}: ${issue.fields.summary}`)
      }
      // Advance only on success — after downtime the old bound catches missed tickets.
      this.store.lastPoll = cycleStart
      this.failures = 0
      this.schedule(this.opts.pollMs)
    } catch (err) {
      this.failures += 1
      const delay = Math.min(this.opts.pollMs * 2 ** this.failures, MAX_BACKOFF_MS)
      console.error(`[svp:jira] poll failed (retry in ${Math.round(delay / 1000)}s):`, (err as Error).message)
      this.schedule(delay)
    }
  }

  // TODO(SVP-7): also poll tracked keys with `updated >= lastPoll` for status changes
  // (Done detection → ingest, Week 2 / F7).
  private async fetchNewTickets(): Promise<JiraIssue[]> {
    const baseJql = this.opts.jql ?? `project = ${this.opts.project} AND labels = ${this.opts.label}`
    const bounds = this.store.lastPoll ? ` AND created >= "${toJqlMinute(this.store.lastPoll)}"` : ''
    const jql = `${baseJql}${bounds} ORDER BY created ASC`
    const url = `${this.opts.baseUrl}/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=summary,description,labels,status,created,assignee`
    const res = await fetch(url, {
      headers: this.opts.pat ? { Authorization: `Bearer ${this.opts.pat}` } : {}
    })
    if (!res.ok) {
      // Jira explains rejections (bad JQL, unknown status name, ...) in the body —
      // surface it, or diagnosing a 400 in the field is guesswork.
      const body = await res.text().catch(() => '')
      throw new Error(`search returned ${res.status}${body ? ` — ${body.slice(0, 300)}` : ''}`)
    }
    const body = (await res.json()) as { issues: JiraIssue[] }
    return body.issues
  }

  private schedule(delay: number): void {
    if (this.disposed) return
    this.timer = setTimeout(() => void this.poll(), delay)
  }
}
