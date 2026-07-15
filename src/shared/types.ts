export type CIEventType = 'test_failed' | 'build_failed' | 'lint_failed' | 'deploy_failed'

/** Where an issue event came from. Jira polling is the main inflow (ARCHITECTURE.md). */
export type IssueSource = 'jira' | 'mock-ci'

/** Reference to the Jira ticket an event was created from. */
export interface JiraTicketRef {
  key: string
  url: string
  /** Jira statusCategory key: 'new' | 'indeterminate' | 'done' */
  status: string
}

/** Normalized issue event entering the pipeline (from Jira polling or the mock CI WS). */
export interface CIEvent {
  id: string
  type: CIEventType
  title: string
  /** Feature/IP area reported by CI. May be wrong — classifier re-checks it. */
  module: string
  branch: string
  log: string
  url: string
  timestamp: string
  /** Absent means the legacy mock CI WebSocket. */
  source?: IssueSource
  /** Present when the event was created from a Jira ticket. */
  jira?: JiraTicketRef
}

export type IssueSeverity = 'critical' | 'major' | 'minor'

/** A wiki note considered relevant to an event. */
export interface WikiMatch {
  file: string
  title: string
  score: number
}

/** Output of the LLM classifier. */
export interface Classification {
  category: string
  severity: IssueSeverity
  /** 0–100. >80 routes to the feature owner, otherwise to the sheriff. */
  confidence: number
  summary: string
  wikiRefs: WikiMatch[]
}

export type RouteTarget = 'feature-owner' | 'sheriff'

export interface Assignment {
  assigneeId: string
  assigneeName: string
  routedTo: RouteTarget
  reason: string
}

export type IssueStatus = 'new' | 'acknowledged' | 'resolved'

/** The fully processed issue shown in the app. */
export interface SheriffIssue {
  event: CIEvent
  classification: Classification
  assignment: Assignment
  status: IssueStatus
  receivedAt: string
}

export type Role = 'member' | 'sheriff'

export interface TeamMember {
  id: string
  name: string
  role: Role
  ownedModules: string[]
}

export interface UserConfig {
  userId: string
  role: Role
}

export type WsStatus = 'connected' | 'disconnected' | 'connecting'

// Client ↔ hub server WebSocket protocol (docs/API.md §1).
// Every frame is one JSON envelope; unknown `type` must be ignored (forward compat).
export const HUB_PROTOCOL_VERSION = 1

export interface HubMessage {
  v: number
  type: string
  ts: string
  payload: unknown
}

export interface HubHelloPayload {
  clientId: string
  appVersion: string
}

export interface HubWelcomePayload {
  user: UserConfig
  team: TeamMember[]
  /** Unresolved issues assigned to this client (state restore on reconnect). */
  issues: SheriffIssue[]
}

export interface HubIssuePayload {
  issue: SheriffIssue
}

export interface HubErrorPayload {
  code: string
  message: string
}

/** Result of a wiki health check (lint operation). */
export interface WikiLintReport {
  generatedAt: string
  noteCount: number
  /** Notes no other note links to. */
  orphanNotes: string[]
  /** Notes with accumulated negative feedback (removal candidates). */
  unhelpfulNotes: string[]
  suggestions: string[]
}

export interface AppState {
  issues: SheriffIssue[]
  team: TeamMember[]
  user: UserConfig
  wsStatus: WsStatus
  notificationsMuted: boolean
  /** False until the server accepts a login — the renderer shows the login view. */
  authed: boolean
}
