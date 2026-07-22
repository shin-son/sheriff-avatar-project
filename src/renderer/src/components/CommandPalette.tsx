import { useEffect, useMemo, useRef, useState } from 'react'
import type { SheriffIssue } from '@shared/types'
import { TYPE_LABEL } from '../format'

interface QuickAction {
  id: string
  label: string
  hint: string
  run: () => void
}

interface Props {
  issues: SheriffIssue[]
  onSelectIssue: (id: string) => void
  onOpenWiki: () => void
  onLintWiki: () => void
  onClose: () => void
}

/**
 * Keyboard-first command palette (⌘K / Ctrl+K). Jump to an issue or run a quick
 * action. Level 5 floating glass; physical key caps for the shortcut hints
 * (DESIGN.md §4). Realizes Principle 1 — "keyboard is the interface".
 */
export default function CommandPalette({
  issues,
  onSelectIssue,
  onOpenWiki,
  onLintWiki,
  onClose
}: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const q = query.trim().toLowerCase()

  const actions = useMemo<QuickAction[]>(
    () => [
      { id: 'act-wiki', label: '위키 열기', hint: 'Obsidian', run: onOpenWiki },
      { id: 'act-lint', label: '위키 점검', hint: '고아 · 부정 노트', run: onLintWiki }
    ],
    [onOpenWiki, onLintWiki]
  )

  const matchedActions = useMemo(
    () => (q ? actions.filter((a) => a.label.toLowerCase().includes(q)) : actions),
    [actions, q]
  )

  const matchedIssues = useMemo(() => {
    const list = q
      ? issues.filter((i) =>
          [i.event.title, i.event.module, i.event.branch, i.assignment.assigneeName].some((s) =>
            s.toLowerCase().includes(q)
          )
        )
      : issues
    return list.slice(0, 8)
  }, [issues, q])

  // Actions first, then issues — one flat list for keyboard navigation.
  const total = matchedActions.length + matchedIssues.length

  useEffect(() => {
    setActive(0)
  }, [query])

  const runAt = (idx: number) => {
    if (idx < matchedActions.length) {
      matchedActions[idx]?.run()
    } else {
      const issue = matchedIssues[idx - matchedActions.length]
      if (issue) onSelectIssue(issue.event.id)
    }
    onClose()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, total - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runAt(active)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="cmdk-overlay" onMouseDown={onClose}>
      <div
        className="cmdk"
        role="dialog"
        aria-label="명령 팔레트"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="이슈로 이동하거나 명령 실행 — 제목 · 모듈 · 담당"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
        />
        <div className="cmdk-list">
          {total === 0 && <div className="cmdk-empty">결과가 없습니다</div>}
          {matchedActions.length > 0 && <div className="cmdk-group">빠른 액션</div>}
          {matchedActions.map((a, idx) => (
            <button
              key={a.id}
              className={`cmdk-item ${active === idx ? 'active' : ''}`}
              onMouseEnter={() => setActive(idx)}
              onClick={() => runAt(idx)}
            >
              <span className="cmdk-item-label">{a.label}</span>
              <span className="cmdk-item-hint">{a.hint}</span>
            </button>
          ))}
          {matchedIssues.length > 0 && <div className="cmdk-group">이슈</div>}
          {matchedIssues.map((issue, idx) => {
            const flatIdx = matchedActions.length + idx
            return (
              <button
                key={issue.event.id}
                className={`cmdk-item ${active === flatIdx ? 'active' : ''}`}
                onMouseEnter={() => setActive(flatIdx)}
                onClick={() => runAt(flatIdx)}
              >
                <span className="cmdk-item-label">{issue.event.title}</span>
                <span className="cmdk-item-meta">
                  {TYPE_LABEL[issue.event.type]} · {issue.assignment.assigneeName}
                </span>
              </button>
            )
          })}
        </div>
        <div className="cmdk-foot">
          <span>
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> 이동
          </span>
          <span>
            <kbd className="kbd">↵</kbd> 선택
          </span>
          <span>
            <kbd className="kbd">esc</kbd> 닫기
          </span>
        </div>
      </div>
    </div>
  )
}
