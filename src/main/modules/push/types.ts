import type { SheriffIssue } from '@shared/types'

/** Handlers the app wires into whichever push transport is active. */
export interface PushListenerHandlers {
  /** A new issue was pushed by the server (e.g. a Jira ticket entered the pipeline). */
  onIssueNew: (issue: SheriffIssue) => void
  /** An existing issue changed on the server (e.g. Jira status update). */
  onIssueUpdated: (issue: SheriffIssue) => void
}

/**
 * Transport-agnostic server-push listener. The app only depends on this
 * interface — the concrete transport (currently Socket.IO, temporary) is
 * swapped behind createPushListener().
 */
export interface PushListener {
  connect(): void
  dispose(): void
}
