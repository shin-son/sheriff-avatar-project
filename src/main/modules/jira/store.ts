import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'

interface StoreData {
  lastPoll: string | null
  processed: string[]
}

/**
 * Persistent dedup table for the F1 invariant: a ticket is classified exactly once,
 * across app restarts. Also keeps the last successful poll time so a restarted or
 * recovered poller catches up instead of re-scanning everything.
 */
export class ProcessedTicketStore {
  private processed = new Set<string>()
  private lastPollValue: string | null = null

  constructor(private readonly filePath: string) {
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as StoreData
      this.processed = new Set(data.processed)
      this.lastPollValue = data.lastPoll
    } catch {
      // First run (or corrupt file): start empty — worst case we re-fetch and dedup.
    }
  }

  has(key: string): boolean {
    return this.processed.has(key)
  }

  markProcessed(key: string): void {
    this.processed.add(key)
    this.save()
  }

  get lastPoll(): string | null {
    return this.lastPollValue
  }

  set lastPoll(iso: string | null) {
    this.lastPollValue = iso
    this.save()
  }

  private save(): void {
    const data: StoreData = { lastPoll: this.lastPollValue, processed: [...this.processed] }
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(data, null, 2))
  }
}
