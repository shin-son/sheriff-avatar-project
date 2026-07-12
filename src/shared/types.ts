export type CIEventType = 'test_failed' | 'build_failed' | 'lint_failed' | 'deploy_failed'

/** Raw event pushed by the CI/CD server over WebSocket. */
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

export interface AppState {
  issues: SheriffIssue[]
  team: TeamMember[]
  user: UserConfig
  wsStatus: WsStatus
}
