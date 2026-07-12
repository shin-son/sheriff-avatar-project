import { useEffect, useState } from 'react'
import type { AppState, IssueStatus } from '@shared/types'
import IssueCard from './components/IssueCard'
import Sidebar from './components/Sidebar'

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)

  useEffect(() => {
    void window.svp.getState().then(setState)
    const offs = [
      window.svp.onIssueNew((issue) =>
        setState((s) => (s ? { ...s, issues: [issue, ...s.issues] } : s))
      ),
      window.svp.onIssueUpdated((issue) =>
        setState((s) =>
          s
            ? { ...s, issues: s.issues.map((i) => (i.event.id === issue.event.id ? issue : i)) }
            : s
        )
      ),
      window.svp.onWsStatus((wsStatus) => setState((s) => (s ? { ...s, wsStatus } : s))),
      window.svp.onIssueFocus((id) => setFocusId(id))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  useEffect(() => {
    if (!focusId) return
    document.getElementById(`issue-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timer = setTimeout(() => setFocusId(null), 2500)
    return () => clearTimeout(timer)
  }, [focusId])

  if (!state) return null

  const isSheriffView = state.user.role === 'sheriff'
  const visible = isSheriffView
    ? state.issues
    : state.issues.filter((i) => i.assignment.assigneeId === state.user.userId)
  const count = (status: IssueStatus) => visible.filter((i) => i.status === status).length

  const selectUser = async (userId: string) => {
    const user = await window.svp.setUser(userId)
    setState((s) => (s ? { ...s, user } : s))
  }

  const setStatus = (id: string, status: IssueStatus) => {
    void window.svp.setIssueStatus(id, status)
  }

  return (
    <div className="app">
      <Sidebar
        team={state.team}
        user={state.user}
        wsStatus={state.wsStatus}
        onSelectUser={selectUser}
      />
      <main className="content">
        <header className="content-header">
          <div>
            <h1>이슈 피드</h1>
            <p className="subtitle">
              {isSheriffView ? '🤠 당번 모드 — 팀 전체 이슈가 표시됩니다' : '내게 배정된 이슈만 표시됩니다'}
            </p>
          </div>
          <div className="stats">
            <span className="stat stat-new">NEW {count('new')}</span>
            <span className="stat stat-ack">진행중 {count('acknowledged')}</span>
            <span className="stat stat-done">해결 {count('resolved')}</span>
          </div>
        </header>
        <section className="feed">
          {visible.length === 0 && (
            <div className="empty">
              <div className="empty-star">🤠</div>
              <p>아직 이슈가 없습니다</p>
              <p className="empty-hint">
                mock CI 서버를 실행하세요: <code>npm run mock:ci</code>
              </p>
            </div>
          )}
          {visible.map((issue) => (
            <IssueCard
              key={issue.event.id}
              issue={issue}
              highlighted={focusId === issue.event.id}
              onSetStatus={setStatus}
            />
          ))}
        </section>
      </main>
    </div>
  )
}
