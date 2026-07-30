import { useState, type ReactNode } from 'react'
import type { AppState, SheriffIssue, WsStatus } from '@shared/types'
import { TYPE_LABEL, formatIssueTime } from '../format'

// Members connect to the sheriff hub, not to CI directly (docs/API.md §1).
const WS_LABEL: Record<WsStatus, string> = {
  connected: '서버 연결됨',
  connecting: '연결 중…',
  disconnected: '연결 끊김'
}

interface Props {
  state: AppState
  issues: SheriffIssue[]
  focusId: string | null
  /** In acrylic mode the title bar renders inside this sheet (frameless: floats outside). */
  titlebar?: ReactNode
  onToggleMuted: () => void
}

/** Small always-usable window for regular members: only their own issues. */
export default function CompactView({
  state,
  issues,
  focusId,
  titlebar,
  onToggleMuted
}: Props) {
  const openCount = issues.filter((i) => i.status !== 'resolved').length

  return (
    <div className="compact">
      {titlebar}
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
        {/* 로그인이 신원을 결정한다 (v3) — 전환 UI 없음 */}
        <span className="user-label" title="로그인 사용자">
          <span className="avatar">{state.user.userId.charAt(0).toUpperCase()}</span>
          {state.user.userId}
        </span>
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
            confidenceMin={state.confidenceMin}
          />
        ))}
      </div>
    </div>
  )
}

function CompactItem({
  issue,
  highlighted,
  confidenceMin
}: {
  issue: SheriffIssue
  highlighted: boolean
  confidenceMin: number
}) {
  const { event, classification, assignment, status } = issue
  // 해결한 담당자가 근거 노트를 평가한다 — 실제로 고친 사람이 노트의 유효성을
  // 가장 잘 안다 (feedback loop, CLAUDE.md wiki 규칙). 해결 확정 후에만 노출.
  const [voted, setVoted] = useState<Record<string, boolean>>({})
  const vote = (noteTitle: string, helpful: boolean) => {
    window.svp.wikiFeedback(noteTitle, helpful)
    setVoted((v) => ({ ...v, [noteTitle]: helpful }))
  }
  // 티켓을 열기만 한다 — In Progress 전이는 담당자가 Jira에서 직접, 폴링이 반영.
  // jira.url이 browse 링크 — event.url은 CICD 파이프라인 링크일 수 있다.
  const checkTicket = () => {
    window.svp.openTicket(event.jira?.url ?? event.url)
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
        {event.jira && <span className="ticket-key">{event.jira.key}</span>}
        <span className="time">{formatIssueTime(event.timestamp)}</span>
      </div>
      <div className="citem-title">{event.title}</div>
      <div className="citem-meta">
        <span
          className={`star-badge star-sm ${classification.confidence > confidenceMin ? 'high' : 'low'}`}
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
      {status === 'resolved' && classification.wikiRefs.length > 0 && (
        <div className="citem-refs">
          <p className="fb-prompt">해결 완료 — 참고된 노트가 도움됐는지 평가해주세요</p>
          {classification.wikiRefs.map((r) => (
            <div key={r.file} className="detail-ref">
              <span className="ref-title">{r.title}</span>
              {voted[r.title] === undefined ? (
                <span className="ref-fb">
                  <button
                    className="fb-btn"
                    title="이 노트가 해결에 도움됨"
                    onClick={() => vote(r.title, true)}
                  >
                    👍
                  </button>
                  <button
                    className="fb-btn"
                    title="이 노트가 도움 안 됨 — 부정 누적 시 정리 후보"
                    onClick={() => vote(r.title, false)}
                  >
                    👎
                  </button>
                </span>
              ) : (
                <span className="ref-fb-done">{voted[r.title] ? '👍' : '👎'} 반영됨</span>
              )}
            </div>
          ))}
        </div>
      )}
    </article>
  )
}
