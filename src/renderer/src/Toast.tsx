import { useEffect, useState } from 'react'
import type { SheriffIssue } from '@shared/types'

export default function Toast() {
  const [issue, setIssue] = useState<SheriffIssue | null>(null)

  useEffect(() => window.svp.onToastData(setIssue), [])

  if (!issue) return null
  const conf = issue.classification.confidence

  return (
    <div className="toast" onClick={() => window.svp.toastClick(issue.event.id)}>
      <span className={`star-badge ${conf > 80 ? 'high' : 'low'}`} title={`신뢰도 ${conf}`}>
        <span className="star-num">{conf}</span>
      </span>
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
          <span className={`toast-route ${issue.assignment.routedTo}`}>
            {issue.assignment.routedTo === 'sheriff' ? '당번 확인 필요' : '자동 배정'}
          </span>
          <span className="toast-assignee">→ {issue.assignment.assigneeName}</span>
        </div>
      </div>
    </div>
  )
}
