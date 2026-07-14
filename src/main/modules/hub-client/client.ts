import WebSocket from 'ws'
import { HUB_PROTOCOL_VERSION } from '@shared/types'
import type {
  HubErrorPayload,
  HubHelloPayload,
  HubIssuePayload,
  HubMessage,
  HubWelcomePayload,
  WsStatus
} from '@shared/types'

const RETRY_MS = 3000

export interface HubClientHandlers {
  /** Snapshot of this client's assigned issues — replaces local state (reconnect restore). */
  onWelcome: (payload: HubWelcomePayload) => void
  onIssueAssigned: (payload: HubIssuePayload) => void
  onIssueUpdated: (payload: HubIssuePayload) => void
  onServerError: (payload: HubErrorPayload) => void
  onStatus: (status: WsStatus) => void
}

/**
 * Client-mode connection to the sheriff hub (docs/API.md §1).
 * Sends client:hello on connect and receives server-filtered pushes.
 * Week 1 is push-only — C→S messages (issue:ack, wiki:feedback) are wired in Week 2.
 */
export class HubClient {
  private ws: WebSocket | null = null
  private disposed = false

  constructor(
    private readonly url: string,
    private readonly hello: HubHelloPayload,
    private readonly handlers: HubClientHandlers
  ) {}

  connect(): void {
    if (this.disposed) return
    this.handlers.onStatus('connecting')
    this.ws = new WebSocket(this.url)
    this.ws.on('open', () => {
      this.handlers.onStatus('connected')
      this.send('client:hello', this.hello)
    })
    this.ws.on('message', (data) => {
      try {
        this.dispatch(JSON.parse(data.toString()) as HubMessage)
      } catch (err) {
        console.error('[svp:hub-client] invalid message', err)
      }
    })
    this.ws.on('error', (err) => console.error('[svp:hub-client]', err.message))
    this.ws.on('close', () => {
      this.handlers.onStatus('disconnected')
      if (!this.disposed) setTimeout(() => this.connect(), RETRY_MS)
    })
  }

  dispose(): void {
    this.disposed = true
    this.ws?.close()
  }

  private send(type: string, payload: unknown): void {
    const msg: HubMessage = { v: HUB_PROTOCOL_VERSION, type, ts: new Date().toISOString(), payload }
    this.ws?.send(JSON.stringify(msg))
  }

  private dispatch(msg: HubMessage): void {
    switch (msg.type) {
      case 'server:welcome':
        this.handlers.onWelcome(msg.payload as HubWelcomePayload)
        break
      case 'issue:assigned':
        this.handlers.onIssueAssigned(msg.payload as HubIssuePayload)
        break
      case 'issue:updated':
        this.handlers.onIssueUpdated(msg.payload as HubIssuePayload)
        break
      case 'server:error':
        this.handlers.onServerError(msg.payload as HubErrorPayload)
        break
      default:
        // Unknown types are ignored on purpose (protocol forward compat).
        break
    }
  }
}
