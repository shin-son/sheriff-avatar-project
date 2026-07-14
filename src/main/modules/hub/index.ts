import { WebSocket, WebSocketServer } from 'ws'
import { TEAM } from '@shared/team'
import type { HubEnvelope, HubHelloPayload, SheriffIssue } from '@shared/types'

/**
 * Client hub (F6): WS server that pushes each member their own issues.
 * Protocol: API.md §1. Public API contract: BACKEND.md F6 — the pipeline
 * calls pushIssue()/notifyUpdated(); everything else is internal.
 * W1 scope is push-only: client→server messages (issue:ack) arrive in W2.
 */

interface HubOptions {
  /** Defaults to SVP_HUB_PORT or 8791. */
  port?: number
  /** server:welcome snapshot — the issue store stays pipeline-owned. */
  getIssuesFor: (clientId: string) => SheriffIssue[]
}

interface Session {
  clientId: string
  socket: WebSocket
  missedPings: number
}

const HEARTBEAT_MS = 30_000

let server: WebSocketServer | null = null
/** One live session per clientId — a new hello replaces the old connection. */
const sessions = new Map<string, Session>()
/** issueId → clientIds currently holding it; reassignment updates must also reach the removed member. */
const holders = new Map<string, Set<string>>()

function envelope(type: string, payload: unknown): string {
  const frame: HubEnvelope = { v: 1, type, ts: new Date().toISOString(), payload }
  return JSON.stringify(frame)
}

function remember(issueId: string, clientId: string): void {
  const set = holders.get(issueId) ?? new Set<string>()
  set.add(clientId)
  holders.set(issueId, set)
}

/** Sends one issue frame; returns false when the client is offline (welcome will restore it). */
function sendIssue(clientId: string, type: 'issue:assigned' | 'issue:updated', issue: SheriffIssue): boolean {
  const session = sessions.get(clientId)
  if (!session || session.socket.readyState !== WebSocket.OPEN) return false
  session.socket.send(envelope(type, { issue }))
  return true
}

function handleHello(socket: WebSocket, payload: HubHelloPayload, opts: HubOptions): Session | null {
  const clientId = String(payload?.clientId ?? '')
  const member = TEAM.find((m) => m.id === clientId)
  if (!member) {
    socket.send(envelope('server:error', { code: 'UNKNOWN_CLIENT', message: `unknown clientId: ${clientId}` }))
    socket.close()
    return null
  }
  sessions.get(clientId)?.socket.close()
  const session: Session = { clientId, socket, missedPings: 0 }
  sessions.set(clientId, session)

  const issues = opts.getIssuesFor(clientId)
  issues.forEach((i) => remember(i.event.id, clientId))
  socket.send(
    envelope('server:welcome', { user: { userId: member.id, role: member.role }, team: TEAM, issues })
  )
  console.log(`[svp:hub] ${clientId} connected (${issues.length} issue(s) restored)`)
  return session
}

export function startHub(opts: HubOptions): void {
  if (server) return
  const port = opts.port ?? Number(process.env.SVP_HUB_PORT ?? 8791)
  server = new WebSocketServer({ port })
  console.log(`[svp:hub] listening on ws://0.0.0.0:${port}`)

  server.on('connection', (socket) => {
    let session: Session | null = null

    socket.on('message', (data) => {
      let frame: HubEnvelope | null = null
      try {
        frame = JSON.parse(String(data)) as HubEnvelope
      } catch {
        return // not JSON: ignore (forward compatibility)
      }
      if (frame?.v !== 1) return
      if (frame.type === 'client:hello' && !session) {
        session = handleHello(socket, frame.payload as HubHelloPayload, opts)
      }
      // Unknown types are ignored by contract; C→S messages land here in W2 (issue:ack).
    })

    socket.on('pong', () => {
      if (session) session.missedPings = 0
    })
    socket.on('close', () => {
      if (session && sessions.get(session.clientId)?.socket === socket) {
        sessions.delete(session.clientId)
        console.log(`[svp:hub] ${session.clientId} disconnected`)
      }
    })
    socket.on('error', () => socket.close())
  })

  // Heartbeat: ping every 30s, terminate after 2 unanswered pings (API.md §1).
  const heartbeat = setInterval(() => {
    for (const session of sessions.values()) {
      if (session.missedPings >= 2) {
        session.socket.terminate()
        sessions.delete(session.clientId)
        console.log(`[svp:hub] ${session.clientId} timed out`)
        continue
      }
      session.missedPings += 1
      session.socket.ping()
    }
  }, HEARTBEAT_MS)
  server.on('close', () => clearInterval(heartbeat))
}

/** New classified+assigned issue → issue:assigned to its assignee only. */
export function pushIssue(issue: SheriffIssue): void {
  const assignee = issue.assignment.assigneeId
  if (sendIssue(assignee, 'issue:assigned', issue)) remember(issue.event.id, assignee)
}

/** Status change / reassignment → issue:updated to everyone holding it (incl. the removed member). */
export function notifyUpdated(issue: SheriffIssue): void {
  const recipients = new Set(holders.get(issue.event.id) ?? [])
  recipients.add(issue.assignment.assigneeId)
  for (const clientId of recipients) {
    if (sendIssue(clientId, 'issue:updated', issue)) remember(issue.event.id, clientId)
  }
}
