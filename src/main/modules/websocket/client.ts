import WebSocket from 'ws'
import type { CIEvent, WsStatus } from '@shared/types'

const RETRY_MS = 3000

/** Receives CI/CD issue events over WebSocket, with auto-reconnect. */
export class CIWebSocketClient {
  private ws: WebSocket | null = null
  private disposed = false

  constructor(
    private readonly url: string,
    private readonly onEvent: (event: CIEvent) => void,
    private readonly onStatus: (status: WsStatus) => void
  ) {}

  connect(): void {
    if (this.disposed) return
    this.onStatus('connecting')
    this.ws = new WebSocket(this.url)
    this.ws.on('open', () => this.onStatus('connected'))
    this.ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString()) as CIEvent
        if (event && event.id && event.type) this.onEvent(event)
      } catch (err) {
        console.error('[svp:ws] invalid message', err)
      }
    })
    this.ws.on('error', (err) => console.error('[svp:ws]', err.message))
    this.ws.on('close', () => {
      this.onStatus('disconnected')
      if (!this.disposed) setTimeout(() => this.connect(), RETRY_MS)
    })
  }

  dispose(): void {
    this.disposed = true
    this.ws?.close()
  }
}
