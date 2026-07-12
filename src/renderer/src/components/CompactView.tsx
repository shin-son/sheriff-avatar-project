import type { AppState, CIEventType, IssueStatus, SheriffIssue, WsStatus } from '@shared/types'

const WS_LABEL: Record<WsStatus, string> = {
  connected: 'CI/CD 연결됨',
  connecting: '연결 중…',
  disconnected: '연결 끊김'
}

const TYPE_LABEL: Record<CIEventType, string> = {
  test_failed: 'TEST FAILED',
  build_failed: 'BUILD FAILED',
  lint_failed: 'LINT FAILED',
  deploy_failed: 'DEPLOY FAILED'
}

interface Props {
  state: AppState
  issues: SheriffIssue[]
  focusId: string | null
  onSelectUser: (userId: string) => void
  onSetStatus: (id: string, status: IssueStatus) => void
}

/** Small always-usable window for regular members: only their own issues. */
export default function CompactView({ state, issues, focusId, onSelectUser, onSetStatus }: Props) {
  const openCount = issues.filter((i) => i.status !== 'resolved').length

  return (
    <div className="compact">
      <header className="compact-header">
        <span className="compact-badge">🤠</span>
        <div className="compact-titles">
          <div className="compact-name">Sheriff Avatar</div>
          <div className={`compact-ws ${state.wsStatus}`}>
            <span className="dot" /> {WS_LABEL[state.wsStatus]}
          </div>
        </div>
        <select
          className="compact-user"
          value={state.user.userId}
          onChange={(e) => onSelectUser(e.target.value)}
          title="사용자 전환 (데모)"
        >
          {state.team.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.role === 'sheriff' ? ' ⭐' : ''}
            </option>
          ))}
        </select>
      </header>

      <div className="compact-sub">내 이슈 · 처리 필요 {openCount}건</div>

      <div className="compact-feed">
        {issues.length === 0 && (
          <div className="empty">
            <div className="empty-star">✨</div>
            <p>배정된 이슈가 없습니다</p>
          </div>
        )}
        {issues.map((issue) => (
          <CompactItem
            key={issue.event.id}
            issue={issue}
            highlighted={focusId === issue.event.id}
            onSetStatus={onSetStatus}
          />
        ))}
      </div>
    </div>
  )
}

function CompactItem({
  issue,
  highlighted,
  onSetStatus
}: {
  issue: SheriffIssue
  highlighted: boolean
  onSetStatus: (id: string, status: IssueStatus) => void
}) {
  const { event, classification, assignment, status } = issue
  return (
    <article
      id={`issue-${event.id}`}
      className={[
        'citem',
        `severity-${classification.severity}`,
        highlighted ? 'highlighted' : '',
        status === 'resolved' ? 'is-resolved' : ''
      ].join(' ')}
    >
      <div className="citem-top">
        <span className={`type-badge t-${event.type}`}>{TYPE_LABEL[event.type]}</span>
        <span className="time">{new Date(event.timestamp).toLocaleTimeString('ko-KR')}</span>
      </div>
      <div className="citem-title">{event.title}</div>
      <div className="citem-meta">
        <span className={`conf-num ${classification.confidence > 80 ? 'high' : 'low'}`}>
          신뢰도 {classification.confidence}
        </span>
        <span className={`route-badge ${assignment.routedTo}`}>
          {assignment.routedTo === 'feature-owner' ? '자동 배정' : '🤠 당번 확인'}
        </span>
      </div>
      <div className="citem-actions">
        {status === 'new' && (
          <button className="btn" onClick={() => onSetStatus(event.id, 'acknowledged')}>
            확인
          </button>
        )}
        {status === 'acknowledged' && <span className="ack-label">진행 중</span>}
        {status !== 'resolved' && (
          <button className="btn btn-primary" onClick={() => onSetStatus(event.id, 'resolved')}>
            해결
          </button>
        )}
        {status === 'resolved' && <span className="resolved-label">✓ 해결됨</span>}
      </div>
    </article>
  )
}
