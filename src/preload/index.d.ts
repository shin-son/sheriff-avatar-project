import type { AppState, IssueStatus, SheriffIssue, UserConfig, WikiLintReport, WsStatus } from '../shared/types'

declare global {
  interface Window {
    svp: {
      frameless: boolean
      getState(): Promise<AppState>
      setUser(userId: string): Promise<UserConfig>
      setIssueStatus(id: string, status: IssueStatus): Promise<SheriffIssue | null>
      onIssueNew(cb: (issue: SheriffIssue) => void): () => void
      onIssueUpdated(cb: (issue: SheriffIssue) => void): () => void
      /** Whole-state invalidation (e.g. hub welcome snapshot) — re-fetch via getState(). */
      onStateRefresh(cb: () => void): () => void
      onWsStatus(cb: (status: WsStatus) => void): () => void
      onIssueFocus(cb: (issueId: string) => void): () => void
      onToastData(cb: (issue: SheriffIssue) => void): () => void
      wikiLint(): Promise<WikiLintReport>
      openWiki(noteTitle?: string): void
      wikiFeedback(noteTitle: string, helpful: boolean): void
      toastClick(issueId: string): void
      toastClose(): void
      winMinimize(): void
      winMaximize(): void
      winClose(): void
      openTicket(url: string): void
      setNotificationsMuted(muted: boolean): Promise<boolean>
      onNotifyMuted(cb: (muted: boolean) => void): () => void
    }
  }
}

export {}
