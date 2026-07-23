import type { SheriffIssue, TeamMember, UserConfig, WsStatus } from '@shared/types'

/** Demo credentials until SVP-5 lands (server: admin/admin → sheriff, id/id → member). */
export interface PushCredentials {
  username: string
  password: string
}

/** Sent by the server right after a successful login. */
export interface PushSession {
  user: UserConfig
  team: TeamMember[]
}

/** Handlers the app wires into whichever push transport is active. */
export interface PushListenerHandlers {
  /** Login accepted — the server says who we are (role decides the view). */
  onSession: (session: PushSession) => void
  /** Login rejected by the server (bad credentials). */
  onAuthError: () => void
  /** A new issue was pushed by the server (e.g. a Jira ticket entered the pipeline). */
  onIssueNew: (issue: SheriffIssue) => void
  /** An existing issue changed on the server (e.g. Jira status/assignee update). */
  onIssueUpdated: (issue: SheriffIssue) => void
  /** Transport connectivity — drives the app's connection badge. */
  onStatus: (status: WsStatus) => void
}

/**
 * Transport-agnostic server-push listener. The app only depends on this
 * interface — the concrete transport (currently Socket.IO, temporary) is
 * swapped behind createPushListener().
 */
export interface PushListener {
  connect(): void
  dispose(): void
  /** C→S: the assignee checked the ticket — the server transitions it in Jira. */
  ackIssue(issueId: string): void
  /** F4 — 당번 수동 재배정. 서버가 Jira assignee를 갱신하고 폴링으로 되돌아온다. */
  reassignIssue(issueId: string, assigneeId: string): void
}
