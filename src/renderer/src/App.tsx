import { useEffect, useRef, useState } from 'react'
import type { AppState, SheriffIssue, WikiLintReport } from '@shared/types'
import Cockpit from './components/Cockpit'
import CommandPalette from './components/CommandPalette'
import CompactView from './components/CompactView'
import DetailPanel from './components/DetailPanel'
import IssueCard from './components/IssueCard'
import LoginView from './components/LoginView'

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [lintReport, setLintReport] = useState<WikiLintReport | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const paletteOpenRef = useRef(paletteOpen)
  paletteOpenRef.current = paletteOpen

  // ⌘K / Ctrl+K toggles the command palette. Escape closes the palette first,
  // then the floating detail panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen((open) => !open)
      } else if (e.key === 'Escape') {
        if (paletteOpenRef.current) setPaletteOpen(false)
        else setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Mark the document ready so CSS may run the stagger reveal. Failsafe: rows
  // stay visible if this never runs or motion is reduced (see global.css).
  useEffect(() => {
    document.documentElement.classList.add('js-ready')
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
      window.svp.onStateRefresh(() => void window.svp.getState().then(setState)),
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

  // ack는 Jira 전이 요청일 뿐 — 상태는 서버가 Jira에서 확인한 뒤 issue:updated로 돌아온다.
  const ackIssue = (id: string) => {
    window.svp.ackIssue(id)
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

  // Window chrome is hidden; this bar hosts the brand, drag region, and window controls.
  // Acrylic mode: rendered inside the glass sheet. Frameless mode: floats as its own pill.
  const frameless = window.svp.frameless
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

  // The server decides who we are (v3): until login succeeds, only the gate shows.
  if (!state.authed) {
    return (
      <div className="shell">
        {frameless && titlebar}
        <LoginView />
      </div>
    )
  }

  // Regular members get a small window with only their own issues.
  if (state.user.role === 'member') {
    const myIssues = sorted.filter((i) => i.assignment.assigneeId === state.user.userId)
    return (
      <div className="shell">
        {frameless && titlebar}
        <CompactView
          state={state}
          issues={myIssues}
          focusId={focusId}
          titlebar={frameless ? undefined : titlebar}
          onAck={ackIssue}
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
  const selected = visible.find((i) => i.event.id === selectedId) ?? null

  // Three triage lanes (rank order is already applied above): the sheriff's own
  // queue, the auto-routed stream, resolved history. The cockpit deck shows the
  // same three figures.
  const triage = visible.filter(
    (i) => i.status !== 'resolved' && i.assignment.routedTo === 'sheriff'
  )
  const stream = visible.filter(
    (i) => i.status !== 'resolved' && i.assignment.routedTo === 'feature-owner'
  )
  const done = visible.filter((i) => i.status === 'resolved')

  return (
    <div className="shell">
      {frameless && titlebar}
      <div className="app">
        <div className="workspace">
          {!frameless && titlebar}
          <Cockpit
            team={state.team}
            user={state.user}
            wsStatus={state.wsStatus}
            muted={state.notificationsMuted}
            counts={{ triage: triage.length, stream: stream.length, done: done.length }}
            onToggleMuted={toggleMuted}
          />
          <div className="toolbar">
            <input
              className="search"
              type="search"
              placeholder="검색 — 제목 · 모듈 · 담당"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              spellCheck={false}
            />
            <span className="toolbar-spacer" />
            <button
              className="cmdk-open"
              onClick={() => setPaletteOpen(true)}
              title="명령 팔레트 (Ctrl+K)"
            >
              <kbd className="kbd">Ctrl</kbd>
              <kbd className="kbd">K</kbd>
            </button>
            <button
              className="btn"
              onClick={() => window.svp.openWiki()}
              title="wiki-vault를 Obsidian으로 열기"
            >
              위키 열기 ↗
            </button>
            <button
              className="btn"
              onClick={() => void window.svp.wikiLint().then(setLintReport)}
              title="wiki 상태 점검 (고아 노트, 부정 신호 누적 노트)"
            >
              위키 점검
            </button>
          </div>

          {lintReport && (
            <div className="lint-card">
              <div className="lint-head">
                <strong>위키 점검 결과</strong>
                <span className="lint-count">노트 {lintReport.noteCount}개</span>
                <button className="toast-close" onClick={() => setLintReport(null)}>
                  ✕
                </button>
              </div>
              {lintReport.orphanNotes.length === 0 && lintReport.unhelpfulNotes.length === 0 ? (
                <p className="lint-ok">정리할 노트 없음 — 노트를 클릭해 열람하려면 위의 위키 열기를 사용하세요</p>
              ) : (
                <ul className="lint-list">
                  {lintReport.orphanNotes.map((t) => (
                    <li key={`orphan-${t}`}>
                      <button className="lint-note" onClick={() => window.svp.openWiki(t)}>
                        {t}
                      </button>{' '}
                      — 참조하는 노트가 없음, 링크하거나 통합 검토
                    </li>
                  ))}
                  {lintReport.unhelpfulNotes.map((t) => (
                    <li key={`unhelpful-${t}`}>
                      <button className="lint-note" onClick={() => window.svp.openWiki(t)}>
                        {t}
                      </button>{' '}
                      — 부정 신호 누적, 내용 수정 또는 삭제 검토
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {visible.length === 0 ? (
            <div className="watchtower">
              <div className="watchtower-star" aria-hidden="true" />
              {q ? (
                <>
                  <p className="watchtower-title">『{query.trim()}』 결과 없음</p>
                  <p className="watchtower-hint">다른 키워드를 시도해보세요</p>
                </>
              ) : (
                <>
                  <p className="watchtower-title">감시 중 — 이슈 대기</p>
                  <p className="watchtower-hint">
                    새 이슈가 들어오면 실시간으로 쌓입니다 · mock CI: <code>npm run mock:ci</code>
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="board">
              <Lane
                title="당번 확인 필요"
                variant="triage"
                emptyLabel="대기 없음"
                issues={triage}
                selectedId={selectedId}
                focusId={focusId}
                onSelect={setSelectedId}
              />
              <Lane
                title="자동 배정"
                emptyLabel="없음"
                issues={stream}
                selectedId={selectedId}
                focusId={focusId}
                onSelect={setSelectedId}
              />
              <Lane
                title="해결됨"
                variant="resolved"
                emptyLabel="없음"
                issues={done}
                selectedId={selectedId}
                focusId={focusId}
                onSelect={setSelectedId}
              />
            </div>
          )}
        </div>
      </div>
      {selected && (
        <DetailPanel issue={selected} onClose={() => setSelectedId(null)} onAck={ackIssue} />
      )}
      {paletteOpen && (
        <CommandPalette
          issues={visible}
          onSelectIssue={(id) => {
            setSelectedId(id)
            document
              .getElementById(`issue-${id}`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }}
          onOpenWiki={() => window.svp.openWiki()}
          onLintWiki={() => void window.svp.wikiLint().then(setLintReport)}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  )
}

/** One column of the triage board. Distinction from siblings is tone + label. */
function Lane({
  title,
  variant,
  emptyLabel,
  issues,
  selectedId,
  focusId,
  onSelect
}: {
  title: string
  variant?: 'triage' | 'resolved'
  emptyLabel: string
  issues: SheriffIssue[]
  selectedId: string | null
  focusId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <section className={`lane ${variant ? `lane-${variant}` : ''}`}>
      <div className="lane-head">
        <span className="lane-title">{title}</span>
        <span className="lane-count">{issues.length}</span>
      </div>
      <div className="lane-body">
        {issues.length === 0 ? (
          <div className="lane-empty">{emptyLabel}</div>
        ) : (
          issues.map((issue, idx) => (
            <IssueCard
              key={issue.event.id}
              issue={issue}
              index={idx}
              selected={issue.event.id === selectedId}
              highlighted={focusId === issue.event.id}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </section>
  )
}
