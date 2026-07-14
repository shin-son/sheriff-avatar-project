import type { SheriffIssue } from '@shared/types'
import { TYPE_LABEL, formatIssueTime } from '../format'

interface Props {
  issue: SheriffIssue
  selected: boolean
  highlighted: boolean
  onSelect: (id: string) => void
}

/** One ledger row; click to open the issue in the floating detail panel. */
export default function IssueCard({ issue, selected, highlighted, onSelect }: Props) {
  const { event, classification, assignment, status } = issue
  const confClass = classification.confidence > 80 ? 'high' : 'low'

  return (
    <article
      id={`issue-${event.id}`}
      className={[
        'row',
        `severity-${classification.severity}`,
        highlighted ? 'highlighted' : '',
        selected ? 'selected' : '',
        status === 'new' ? 'is-new' : '',
        status === 'resolved' ? 'is-resolved' : ''
      ].join(' ')}
    >
      <button className="row-line" aria-pressed={selected} onClick={() => onSelect(event.id)}>
        <span
          className={`star-badge star-sm ${confClass}`}
          title={`신뢰도 ${classification.confidence} — 80 초과 시 자동 배정`}
        >
          <span className="star-num">{classification.confidence}</span>
        </span>
        <span className="row-type">{TYPE_LABEL[event.type]}</span>
        <span className="row-title">{event.title}</span>
        <span className="row-meta">
          {event.module} · {event.branch}
        </span>
        <span className="row-assignee">{assignment.assigneeName}</span>
        <span className="row-time">{formatIssueTime(event.timestamp)}</span>
      </button>
    </article>
  )
}
