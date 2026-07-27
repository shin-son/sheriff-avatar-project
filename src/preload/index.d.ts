import type { AppState, SheriffIssue, WikiLintReport, WsStatus } from '../shared/types'

declare global {
  interface Window {
    svp: {
      frameless: boolean
      getState(): Promise<AppState>
      /** Demo auth (SVP-5 전까지): 서버가 검증하고 role을 내려준다. */
      login(username: string, password: string): Promise<{ ok: boolean; error?: string }>
      /** 수동 배정 (sheriff 전용) — 서버가 Jira assignee 갱신, 결과는 폴링 후 issue:updated로 반영 */
      reassignIssue(id: string, assigneeId: string): void
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
