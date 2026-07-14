import { useEffect, useState } from 'react'
import type { AppState, IssueStatus, SheriffIssue, WikiLintReport } from '@shared/types'
import CompactView from './components/CompactView'
import DetailPanel from './components/DetailPanel'
import IssueCard from './components/IssueCard'
import Sidebar from './components/Sidebar'

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [lintReport, setLintReport] = useState<WikiLintReport | null>(null)

  // The floating detail panel closes on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    void window.svp.getState().then(setState)
    const offs = [
      window.svp.onIssueNew((issue) =>
        setState((s) => (s ? { ...s, issues: [issue, ...s.issues] } : s))
      ),
      window.svp.onIssueUpdated((issue) =>
        setState((s) =>
          s
            ? {
                ...s,
                issues: s.issues.map((i) => (i.event.id === issue.event.id ? issue : i))
              }
            : s
        )
      ),
      window.svp.onWsStatus((wsStatus) => setState((s) => (s ? { ...s, wsStatus } : s))),
      window.svp.onNotifyMuted((muted) =>
        setState((s) => (s ? { ...s, notificationsMuted: muted } : s))
      ),
      window.svp.onIssueFocus((id) => setFocusId(id))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  useEffect(() => {
    if (!focusId) return
    setSelectedId(focusId) // toast click opens the issue in the detail panel
    document
      .getElementById(`issue-${focusId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timer = setTimeout(() => setFocusId(null), 2500)
    return () => clearTimeout(timer)
  }, [focusId])

  if (!state) return null

  const selectUser = async (userId: string) => {
    const user = await window.svp.setUser(userId)
    setState((s) => (s ? { ...s, user } : s))
  }

  const setStatus = (id: string, status: IssueStatus) => {
    void window.svp.setIssueStatus(id, status)
  }

  const toggleMuted = () => {
    void window.svp.setNotificationsMuted(!state.notificationsMuted)
    // state update arrives via onNotifyMuted (also covers tray-menu toggles)
  }

  // Triage order: unresolved sheriff-queue first, then auto-assigned, resolved last.
  const rank = (i: SheriffIssue) =>
    i.status === 'resolved' ? 2 : i.assignment.routedTo === 'sheriff' ? 0 : 1
  const sorted = [...state.issues].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      new Date(b.event.timestamp).getTime() - new Date(a.event.timestamp).getTime()
  )

  // Window chrome is hidden (titleBarOverlay); this bar hosts the brand and drag region.
  const titlebar = (
    <div className="titlebar">
      <span className="brand-star brand-star-sm" aria-hidden="true" />
      <span className="titlebar-name">Sheriff Avatar</span>
      <span className="titlebar-sub">SVP · LLM-WIKI Agent</span>
      <div className="win-controls">
        <button className="win-btn" title="최소화" onClick={() => window.svp.winMinimize()}>
          ─
        </button>
        <button className="win-btn" title="최대화/복원" onClick={() => window.svp.winMaximize()}>
          ▢
        </button>
        <button className="win-btn win-close" title="닫기" onClick={() => window.svp.winClose()}>
          ✕
        </button>
      </div>
    </div>
  )

  // Regular members get a small window with only their own issues.
  if (state.user.role === 'member') {
    const myIssues = sorted.filter((i) => i.assignment.assigneeId === state.user.userId)
    return (
      <div className="shell">
        {titlebar}
        <CompactView
          state={state}
          issues={myIssues}
          focusId={focusId}
          onSelectUser={selectUser}
          onSetStatus={setStatus}
          onToggleMuted={toggleMuted}
        />
      </div>
    )
  }

  // Sheriff (당번) gets the full operator dashboard with every issue.
  const q = query.trim().toLowerCase()
  const visible = q
    ? sorted.filter((i) =>
        [i.event.title, i.event.module, i.event.branch, i.assignment.assigneeName].some((s) =>
          s.toLowerCase().includes(q)
        )
      )
    : sorted
  const count = (status: IssueStatus) => visible.filter((i) => i.status === status).length
  const selected = visible.find((i) => i.event.id === selectedId) ?? null

  return (
    <div className="shell">
      {titlebar}
      <div className="app">
        <div className="workspace">
          <Sidebar
            team={state.team}
            user={state.user}
            wsStatus={state.wsStatus}
            muted={state.notificationsMuted}
            onSelectUser={selectUser}
            onToggleMuted={toggleMuted}
          />
          <main className="content">
            <header className="content-header">
              <div>
                <h1>이슈 대장</h1>
                <p className="subtitle">당번 모드 — 팀 전체 이슈가 표시됩니다</p>
              </div>
              <input
                className="search"
                type="search"
                placeholder="검색 — 제목 · 모듈 · 담당"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                spellCheck={false}
              />
              <div className="stats">
                <span className="stat">NEW {count('new')}</span>
                <span className="stat">진행중 {count('acknowledged')}</span>
                <span className="stat">해결 {count('resolved')}</span>
                <button
                  className="btn"
                  onClick={() => void window.svp.wikiLint().then(setLintReport)}
                  title="wiki 상태 점검 (고아 노트, 부정 피드백 노트)"
                >
                  WIKI 점검
                </button>
              </div>
            </header>
            <section className="ledger">
              {lintReport && (
                <div className="lint-card">
                  <div className="lint-head">
                    <strong>WIKI 점검 결과</strong>
                    <span className="lint-count">노트 {lintReport.noteCount}개</span>
                    <button className="toast-close" onClick={() => setLintReport(null)}>
                      ✕
                    </button>
                  </div>
                  {lintReport.suggestions.length === 0 ? (
                    <p className="lint-ok">문제 없음</p>
                  ) : (
                    <ul className="lint-list">
                      {lintReport.suggestions.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {visible.length === 0 && (
                <div className="empty">
                  <div className="empty-star" aria-hidden="true" />
                  {q ? (
                    <p>『{query.trim()}』에 해당하는 이슈가 없습니다</p>
                  ) : (
                    <>
                      <p>아직 이슈가 없습니다</p>
                      <p className="empty-hint">
                        mock CI 서버를 실행하세요: <code>npm run mock:ci</code>
                      </p>
                    </>
                  )}
                </div>
              )}
              {visible.length > 0 && (
                <div className="ledger-head">
                  <span>신뢰도</span>
                  <span>유형</span>
                  <span>제목</span>
                  <span>모듈 · 브랜치</span>
                  <span>담당</span>
                  <span className="th-time">시간</span>
                </div>
              )}
              {visible.map((issue) => (
                <IssueCard
                  key={issue.event.id}
                  issue={issue}
                  selected={issue.event.id === selectedId}
                  highlighted={focusId === issue.event.id}
                  onSelect={setSelectedId}
                />
              ))}
            </section>
          </main>
        </div>
      </div>
      {selected && (
        <DetailPanel issue={selected} onClose={() => setSelectedId(null)} onSetStatus={setStatus} />
      )}
    </div>
  )
}
