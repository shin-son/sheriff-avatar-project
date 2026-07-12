import type { CIEventType, IssueStatus, SheriffIssue } from '@shared/types'

const TYPE_LABEL: Record<CIEventType, string> = {
  test_failed: 'TEST FAILED',
  build_failed: 'BUILD FAILED',
  lint_failed: 'LINT FAILED',
  deploy_failed: 'DEPLOY FAILED'
}

interface Props {
  issue: SheriffIssue
  highlighted: boolean
  onSetStatus: (id: string, status: IssueStatus) => void
}

export default function IssueCard({ issue, highlighted, onSetStatus }: Props) {
  const { event, classification, assignment, status } = issue
  const confClass = classification.confidence > 80 ? 'high' : 'low'

  return (
    <article
      id={`issue-${event.id}`}
      className={[
        'card',
        `severity-${classification.severity}`,
        highlighted ? 'highlighted' : '',
        status === 'resolved' ? 'is-resolved' : ''
      ].join(' ')}
    >
      <div className="card-top">
        <span className={`type-badge t-${event.type}`}>{TYPE_LABEL[event.type]}</span>
        <span className="chip">{event.module}</span>
        <span className="chip chip-dim">{event.branch}</span>
        <span className="time">{new Date(event.timestamp).toLocaleTimeString('ko-KR')}</span>
      </div>

      <h3 className="card-title">{event.title}</h3>
      <p className="card-summary">{classification.summary}</p>

      <div className="card-meta">
        <div className="confidence">
          <span className="meta-label">신뢰도</span>
          <div className="conf-bar">
            <div
              className={`conf-fill ${confClass}`}
              style={{ width: `${classification.confidence}%` }}
            />
          </div>
          <span className={`conf-num ${confClass}`}>{classification.confidence}</span>
        </div>
        <span className={`route-badge ${assignment.routedTo}`}>
          {assignment.routedTo === 'feature-owner' ? '담당자 자동 배정' : '🤠 당번 확인 필요'}
        </span>
        <span className="assignee">
          <span className="avatar avatar-sm">{assignment.assigneeName.charAt(0)}</span>
          {assignment.assigneeName}
        </span>
      </div>

      <p className="reason">{assignment.reason}</p>

      {classification.wikiRefs.length > 0 && (
        <div className="wiki-refs">
          {classification.wikiRefs.map((r) => (
            <span key={r.file} className="wiki-ref">
              📄 {r.title}
            </span>
          ))}
        </div>
      )}

      <div className="card-actions">
        {status === 'new' && (
          <button className="btn" onClick={() => onSetStatus(event.id, 'acknowledged')}>
            확인
          </button>
        )}
        {status === 'acknowledged' && <span className="ack-label">진행 중</span>}
        {status !== 'resolved' && (
          <button className="btn btn-primary" onClick={() => onSetStatus(event.id, 'resolved')}>
            해결 완료 → WIKI 기록
          </button>
        )}
        {status === 'resolved' && <span className="resolved-label">✓ 해결됨 · case-log.md에 기록됨</span>}
      </div>
    </article>
  )
}
