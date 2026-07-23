import { io, type Socket } from 'socket.io-client'
import type { SheriffIssue } from '@shared/types'
import type { PushCredentials, PushListener, PushListenerHandlers, PushSession } from './types'

// TEMPORARY contract — the real server is not implemented yet. Assumed shape
// (implemented by mock/svp-server.mjs): login via handshake auth, then the
// server emits `session` once and fully processed SheriffIssue objects on
// issue:new / issue:updated. Replace this file (and createPushListener in
// ./index.ts) when the server contract lands; nothing outside modules/push/
// depends on Socket.IO.
const EVENT_SESSION = 'session'
const EVENT_ISSUE_NEW = 'issue:new'
const EVENT_ISSUE_UPDATED = 'issue:updated'
const EVENT_ISSUE_ACK = 'issue:ack'
const EVENT_ISSUE_REASSIGN = 'issue:reassign'
const AUTH_FAILED = 'AUTH_FAILED'

/** Socket.IO push listener. Reconnection/backoff is handled by socket.io-client. */
export class SocketIoPushListener implements PushListener {
  private socket: Socket | null = null

  constructor(
    private readonly url: string,
    private readonly credentials: PushCredentials,
    private readonly handlers: PushListenerHandlers
  ) {}

  connect(): void {
    this.handlers.onStatus('connecting')
    this.socket = io(this.url, { auth: { ...this.credentials } })
    this.socket.on('connect', () => {
      console.log(`[svp:push] connected to ${this.url}`)
      this.handlers.onStatus('connected')
    })
    this.socket.on('disconnect', (reason) => {
      console.log(`[svp:push] disconnected (${reason})`)
      this.handlers.onStatus('disconnected')
    })
    this.socket.on('connect_error', (err) => {
      console.error(`[svp:push] connect error: ${err.message}`)
      if (err.message === AUTH_FAILED) {
        // Wrong credentials — retrying is pointless; the login screen reprompts.
        this.dispose()
        this.handlers.onAuthError()
      } else {
        this.handlers.onStatus('disconnected')
      }
    })
    this.socket.on(EVENT_SESSION, (payload: unknown) => this.handlers.onSession(payload as PushSession))
    this.socket.on(EVENT_ISSUE_NEW, (payload: unknown) => this.dispatch(payload, this.handlers.onIssueNew))
    this.socket.on(EVENT_ISSUE_UPDATED, (payload: unknown) =>
      this.dispatch(payload, this.handlers.onIssueUpdated)
    )
  }

  dispose(): void {
    this.socket?.disconnect()
    this.socket = null
  }

  ackIssue(issueId: string): void {
    this.socket?.emit(EVENT_ISSUE_ACK, { issueId })
  }

  reassignIssue(issueId: string, assigneeId: string): void {
    this.socket?.emit(EVENT_ISSUE_REASSIGN, { issueId, assigneeId })
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
