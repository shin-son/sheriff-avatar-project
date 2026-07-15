import { io, type Socket } from 'socket.io-client'
import type { SheriffIssue } from '@shared/types'
import type { PushListener, PushListenerHandlers } from './types'

// TEMPORARY contract — the real server is not implemented yet. Assumed shape:
// the server emits fully processed SheriffIssue objects on these events
// (mirrors the hub protocol's issue:assigned / issue:updated semantics).
// Replace this file (and createPushListener in ./index.ts) when the server
// contract lands; nothing outside modules/push/ depends on Socket.IO.
const EVENT_ISSUE_NEW = 'issue:new'
const EVENT_ISSUE_UPDATED = 'issue:updated'

/** Socket.IO push listener. Reconnection/backoff is handled by socket.io-client. */
export class SocketIoPushListener implements PushListener {
  private socket: Socket | null = null

  constructor(
    private readonly url: string,
    private readonly clientId: string,
    private readonly handlers: PushListenerHandlers
  ) {}

  connect(): void {
    this.socket = io(this.url, { auth: { clientId: this.clientId } })
    this.socket.on('connect', () => console.log(`[svp:push] connected to ${this.url}`))
    this.socket.on('disconnect', (reason) => console.log(`[svp:push] disconnected (${reason})`))
    this.socket.on('connect_error', (err) => console.error(`[svp:push] connect error: ${err.message}`))
    this.socket.on(EVENT_ISSUE_NEW, (payload: unknown) => this.dispatch(payload, this.handlers.onIssueNew))
    this.socket.on(EVENT_ISSUE_UPDATED, (payload: unknown) =>
      this.dispatch(payload, this.handlers.onIssueUpdated)
    )
  }

  dispose(): void {
    this.socket?.disconnect()
    this.socket = null
  }

  private dispatch(payload: unknown, handler: (issue: SheriffIssue) => void): void {
    const issue = payload as SheriffIssue
    if (!issue?.event?.id) {
      console.error('[svp:push] malformed issue payload ignored', payload)
      return
    }
    handler(issue)
  }
}
