import { useState } from 'react'
import type { SheriffIssue, TeamMember } from '@shared/types'
import { TYPE_LABEL, formatIssueTime } from '../format'

interface Props {
  issue: SheriffIssue
  team: TeamMember[]
  onClose: () => void
  onAck: (id: string) => void
  /** F4 — 당번 수동 재배정. 결과는 서버가 Jira 갱신 후 issue:updated로 되돌린다. */
  onReassign: (id: string, assigneeId: string) => void
}

/** Floating glass panel with the selected issue's detail (reference: detached side card). */
export default function DetailPanel({ issue, team, onClose, onAck, onReassign }: Props) {
  const { event, classification, assignment, status } = issue
  const confClass = classification.confidence > 80 ? 'high' : 'low'
  const [target, setTarget] = useState('')
  // 재배정 후보: 현재 담당자를 제외한 팀원 (당번 자신은 후보가 아님)
  const candidates = team.filter((m) => m.role === 'member' && m.id !== assignment.assigneeId)

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

        {status !== 'resolved' && candidates.length > 0 && (
          <div className="detail-section">
            <div className="detail-label">재배정 (human-in-the-loop)</div>
            <div className="reassign-row">
              <select
                className="reassign-select"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">팀원 선택…</option>
                {candidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button
                className="btn"
                disabled={!target}
                onClick={() => {
                  onReassign(event.id, target)
                  setTarget('')
                }}
              >
                재배정
              </button>
            </div>
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
