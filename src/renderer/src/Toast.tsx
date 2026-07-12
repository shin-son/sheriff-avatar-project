import { useEffect, useState } from 'react'
import type { SheriffIssue } from '@shared/types'

export default function Toast() {
  const [issue, setIssue] = useState<SheriffIssue | null>(null)

  useEffect(() => window.svp.onToastData(setIssue), [])

  if (!issue) return null
  const conf = issue.classification.confidence

  return (
    <div className="toast" onClick={() => window.svp.toastClick(issue.event.id)}>
      <div className="toast-icon">{issue.assignment.routedTo === 'sheriff' ? '🤠' : '🔔'}</div>
      <div className="toast-content">
        <div className="toast-header">
          <span className="toast-app">SHERIFF AVATAR</span>
          <button
            className="toast-close"
            onClick={(e) => {
              e.stopPropagation()
              window.svp.toastClose()
            }}
          >
            ✕
          </button>
        </div>
        <div className="toast-title">{issue.event.title}</div>
        <div className="toast-meta">
          <span className={`toast-conf ${conf > 80 ? 'high' : 'low'}`}>신뢰도 {conf}</span>
          <span className="toast-assignee">→ {issue.assignment.assigneeName}</span>
        </div>
      </div>
    </div>
  )
}
