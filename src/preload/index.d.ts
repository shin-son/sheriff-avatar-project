import type { AppState, IssueStatus, SheriffIssue, UserConfig, WikiLintReport, WsStatus } from '../shared/types'

declare global {
  interface Window {
    svp: {
      getState(): Promise<AppState>
      setUser(userId: string): Promise<UserConfig>
      setIssueStatus(id: string, status: IssueStatus): Promise<SheriffIssue | null>
      onIssueNew(cb: (issue: SheriffIssue) => void): () => void
      onIssueUpdated(cb: (issue: SheriffIssue) => void): () => void
      onWsStatus(cb: (status: WsStatus) => void): () => void
      onIssueFocus(cb: (issueId: string) => void): () => void
      onToastData(cb: (issue: SheriffIssue) => void): () => void
      wikiLint(): Promise<WikiLintReport>
      wikiFeedback(noteTitle: string, helpful: boolean): void
      toastClick(issueId: string): void
      toastClose(): void
    }
  }
}

export {}
