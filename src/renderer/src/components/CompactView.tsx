import type { AppState, IssueStatus, SheriffIssue, WsStatus } from '@shared/types'
import { TYPE_LABEL, formatIssueTime } from '../format'

const WS_LABEL: Record<WsStatus, string> = {
  connected: 'CI/CD 연결됨',
  connecting: '연결 중…',
  disconnected: '연결 끊김'
}

interface Props {
  state: AppState
  issues: SheriffIssue[]
  focusId: string | null
  onSelectUser: (userId: string) => void
  onSetStatus: (id: string, status: IssueStatus) => void
  onToggleMuted: () => void
}

/** Small always-usable window for regular members: only their own issues. */
export default function CompactView({
  state,
  issues,
  focusId,
  onSelectUser,
  onSetStatus,
  onToggleMuted
}: Props) {
  const openCount = issues.filter((i) => i.status !== 'resolved').length

  return (
    <div className="compact">
      <header className="compact-header">
        <div className={`compact-ws ${state.wsStatus}`}>
          <span className="dot" /> {WS_LABEL[state.wsStatus]}
        </div>
        <button
          className={`notify-toggle-sm ${state.notificationsMuted ? 'off' : ''}`}
          title={state.notificationsMuted ? '알림 팝업 다시 켜기' : '알림 팝업 끄기'}
          onClick={onToggleMuted}
        >
          {state.notificationsMuted ? '알림 꺼짐' : '알림 켜짐'}
        </button>
        <select
          className="compact-user"
          value={state.user.userId}
          onChange={(e) => onSelectUser(e.target.value)}
          title="사용자 전환 (데모)"
        >
          {state.team.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.role === 'sheriff' ? ' (당번)' : ''}
            </option>
          ))}
        </select>
      </header>

      <div className="compact-sub">내 이슈 · 처리 필요 {openCount}건</div>

      <div className="compact-feed">
        {issues.length === 0 && (
          <div className="empty">
            <div className="empty-star" aria-hidden="true" />
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
  const checkTicket = () => {
    window.svp.openTicket(event.url)
    if (status === 'new') onSetStatus(event.id, 'acknowledged')
  }
  return (
    <article
      id={`issue-${event.id}`}
      className={[
        'citem',
        `severity-${classification.severity}`,
        highlighted ? 'highlighted' : '',
        status === 'new' ? 'is-new' : '',
        status === 'resolved' ? 'is-resolved' : ''
      ].join(' ')}
    >
      <div className="citem-top">
        <span className={`type-badge t-${event.type}`}>{TYPE_LABEL[event.type]}</span>
        <span className="time">{formatIssueTime(event.timestamp)}</span>
      </div>
      <div className="citem-title">{event.title}</div>
      <div className="citem-meta">
        <span
          className={`star-badge star-sm ${classification.confidence > 80 ? 'high' : 'low'}`}
          title={`신뢰도 ${classification.confidence}`}
        >
          <span className="star-num">{classification.confidence}</span>
        </span>
        <span className={`route-badge ${assignment.routedTo}`}>
          {assignment.routedTo === 'feature-owner' ? '자동 배정' : '당번 확인 필요'}
        </span>
      </div>
      <div className="citem-actions">
        {status === 'acknowledged' && <span className="ack-label">진행 중</span>}
        {status === 'resolved' && <span className="resolved-label">✓ 해결됨</span>}
        {status !== 'resolved' && (
          <button className="btn btn-primary" onClick={checkTicket}>
            티켓 확인 ↗
          </button>
        )}
      </div>
    </article>
  )
}
