import type { SheriffIssue, TeamMember, UserConfig, WikiLintReport, WsStatus } from '@shared/types'

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
  /** C→S (sheriff only): manual assignment — the server updates the Jira assignee (F4). */
  reassignIssue(issueId: string, assigneeId: string): void
  /** C→S: 담당자의 노트 원인 일치/불일치 피드백 → 서버 vault에 누적 (query 감점, F8). */
  sendFeedback(noteTitle: string, helpful: boolean): void
  /** C→S (sheriff only): 서버 vault 점검 요청 — 실패/미접속/타임아웃이면 null. */
  requestLint(): Promise<WikiLintReport | null>
}
