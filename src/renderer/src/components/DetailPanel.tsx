import type { SheriffIssue } from '@shared/types'
import { TYPE_LABEL, formatIssueTime } from '../format'

interface Props {
  issue: SheriffIssue
  onClose: () => void
  onAck: (id: string) => void
}

/** Floating glass panel with the selected issue's detail (reference: detached side card). */
export default function DetailPanel({ issue, onClose, onAck }: Props) {
  const { event, classification, assignment, status } = issue
  const confClass = classification.confidence > 80 ? 'high' : 'low'

  // "확인" = open the ticket + ack (the server transitions it in Jira).
  // Status is never written locally — it comes back once the server confirms it in Jira.
  const checkTicket = () => {
    window.svp.openTicket(event.url)
    if (status === 'new') onAck(event.id)
  }

  return (
    <aside className="detail">
      <div className="detail-head">
        <span className={`row-type ${classification.severity === 'critical' ? 'crit' : ''}`}>
          {TYPE_LABEL[event.type]}
        </span>
        <button className="detail-close" title="닫기" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="detail-body">
        <h2 className="detail-title">{event.title}</h2>

        <div className="detail-star">
          <span className={`star-badge ${confClass}`}>
            <span className="star-num">{classification.confidence}</span>
          </span>
          <div>
            <div className="detail-conf">신뢰도 {classification.confidence} / 100</div>
            <div className="detail-route">
              {assignment.routedTo === 'feature-owner' ? '담당자 자동 배정' : '당번 확인 필요'} ·{' '}
              {assignment.assigneeName}
            </div>
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-label">요약</div>
          <p className="detail-text">{classification.summary}</p>
        </div>

        <div className="detail-section">
          <div className="detail-label">배정 근거</div>
          <p className="detail-text">{assignment.reason}</p>
        </div>

        {classification.wikiRefs.length > 0 && (
          <div className="detail-section">
            <div className="detail-label">참고 (LLM-WIKI)</div>
            {classification.wikiRefs.map((r) => (
              <div key={r.file} className="detail-ref">
                {r.title}
              </div>
            ))}
          </div>
        )}

        <div className="detail-section detail-meta">
          {event.module} · {event.branch} · {formatIssueTime(event.timestamp)}
        </div>
      </div>

      <div className="detail-actions">
        {status === 'acknowledged' && <span className="ack-label">진행 중 — 해결은 Jira에서 Done 처리</span>}
        {status === 'resolved' && <span className="resolved-label">✓ 해결됨 · case-log.md에 기록됨</span>}
        {status !== 'resolved' && (
          <button className="btn btn-primary detail-goto" onClick={checkTicket}>
            티켓 확인 ↗
          </button>
        )}
      </div>
    </aside>
  )
}
