// Server → client push channel (Jira updates). The Socket.IO implementation is
// TEMPORARY (server contract not final) — swap it here when the real server
// lands; callers only see the PushListener interface.
import { SocketIoPushListener } from './socketio'
import type { PushCredentials, PushListener, PushListenerHandlers } from './types'

export type { PushCredentials, PushListener, PushListenerHandlers, PushSession } from './types'

export function createPushListener(
  url: string,
  credentials: PushCredentials,
  handlers: PushListenerHandlers
): PushListener {
  return new SocketIoPushListener(url, credentials, handlers)
}
