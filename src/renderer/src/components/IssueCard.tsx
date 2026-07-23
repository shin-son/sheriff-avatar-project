import type { CSSProperties } from 'react'
import type { SheriffIssue } from '@shared/types'
import { TYPE_LABEL, formatIssueTime } from '../format'

interface Props {
  issue: SheriffIssue
  selected: boolean
  highlighted: boolean
  onSelect: (id: string) => void
  /** Position within its lane — drives the stagger reveal delay (global.css). */
  index?: number
}

/** One issue card inside a triage lane; click to open it in the floating detail panel. */
export default function IssueCard({ issue, selected, highlighted, onSelect, index = 0 }: Props) {
  const { event, classification, assignment, status } = issue
  const confClass = classification.confidence > 80 ? 'high' : 'low'

  return (
    <article
      id={`issue-${event.id}`}
      style={{ '--row-index': index } as CSSProperties}
      className={[
        'row',
        `severity-${classification.severity}`,
        assignment.routedTo === 'feature-owner' ? 'auto' : '',
        highlighted ? 'highlighted' : '',
        selected ? 'selected' : '',
        status === 'new' ? 'is-new' : '',
        status === 'resolved' ? 'is-resolved' : ''
      ].join(' ')}
    >
      <button className="row-line" aria-pressed={selected} onClick={() => onSelect(event.id)}>
        <div className="card-top">
          <span
            className={`star-badge star-sm ${confClass}`}
            title={`신뢰도 ${classification.confidence} — 80 초과 시 자동 배정`}
          >
            <span className="star-num">{classification.confidence}</span>
          </span>
          <span className="row-type">{TYPE_LABEL[event.type]}</span>
          <span className="row-time">{formatIssueTime(event.timestamp)}</span>
        </div>
        <div className="row-title">{event.title}</div>
        <div className="row-meta">
          {event.module} · {event.branch}
        </div>
        <div className="row-assignee">{assignment.assigneeName}</div>
      </button>
    </article>
  )
}
