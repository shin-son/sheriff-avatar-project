import { useState } from 'react'
import type { SheriffIssue, TeamMember } from '@shared/types'
import { TYPE_LABEL, formatIssueTime } from '../format'

interface Props {
  issue: SheriffIssue
  team: TeamMember[]
  onClose: () => void
  /** 수동 배정 (F4) — 서버가 Jira assignee를 갱신, 반영은 issue:updated로 돌아온다. */
  onReassign: (id: string, assigneeId: string) => void
}

/** Floating glass panel with the selected issue's detail (reference: detached side card). */
export default function DetailPanel({ issue, team, onClose, onReassign }: Props) {
  const { event, classification, assignment, status } = issue
  const confClass = classification.confidence > 80 ? 'high' : 'low'
  const [pick, setPick] = useState('')

  // Module owners first in the picker (wiki frontmatter → TeamMember.ownedModules).
  // The classifier's category is the trusted module; CI's own module field is the fallback.
  const module =
    classification.category && classification.category !== 'unknown'
      ? classification.category
      : event.module
  const isOwner = (m: TeamMember) => m.ownedModules.includes(module)
  // issue.candidates (Gerrit/wiki signal) takes priority over the plain team list.
  const smartCandidates = issue.candidates ?? []
  const teamCandidates = team
    .filter((m) => m.role === 'member')
    .sort((a, b) => Number(isOwner(b)) - Number(isOwner(a)))

  // "확인" opens the ticket only. In Progress is the assignee's move in Jira —
  // the poller detects the status change and pushes it back (issue:updated).
  // jira.url is the browse link; event.url may carry the CICD pipeline link instead.
  const checkTicket = () => {
    window.svp.openTicket(event.jira?.url ?? event.url)
  }

  return (
    <aside className="detail">
      <div className="detail-head">
        <span className={`row-type ${classification.severity === 'critical' ? 'crit' : ''}`}>
          {TYPE_LABEL[event.type]}
        </span>
        {event.jira && <span className="ticket-key">{event.jira.key}</span>}
        <button className="detail-close" title="닫기" onClick={onClose}>
          ✕
        </button>
      </div>

      {/* Primary CTA promoted to the top of the panel — the sheriff's one action
          (배정 확인) is the highest-hierarchy element, not buried at the bottom. */}
      <div className="detail-cta">
        {status === 'acknowledged' && (
          <span className="ack-label">진행 중 — 해결은 Jira에서 Done 처리</span>
        )}
        {status === 'resolved' && (
          <span className="resolved-label">✓ 해결됨 · case-log.md에 기록됨</span>
        )}
        {status !== 'resolved' && (
          <button className="btn btn-primary detail-goto" onClick={checkTicket}>
            티켓 확인 ↗
          </button>
        )}
      </div>

      <div className="detail-body">
        <h2 className="detail-title">{event.title}</h2>

        <div className="detail-star hero">
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

        {status !== 'resolved' && (smartCandidates.length > 0 || teamCandidates.length > 0) && (
          <div className="detail-section">
            <div className="detail-label">담당자 배정</div>
            {smartCandidates.length > 0 && (
              <div className="candidates-list">
                {smartCandidates.map((c) => (
                  <button
                    key={`${c.source}-${c.id}`}
                    className={`candidate-item${pick === c.id ? ' selected' : ''}`}
                    title={c.reason}
                    onClick={() => setPick(c.id)}
                  >
                    <span className={`candidate-badge source-${c.source}`}>{c.source}</span>
                    <span className="candidate-name">{c.name}</span>
                    <span className="candidate-reason">{c.reason}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="assign-row">
              <select
                className="assign-select"
                value={pick}
                onChange={(e) => setPick(e.target.value)}
              >
                <option value="">팀원 선택…</option>
                {teamCandidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {isOwner(m) ? ` — ${module} 담당` : ''}
                  </option>
                ))}
              </select>
              <button
                className="btn"
                disabled={!pick || pick === assignment.assigneeId}
                title="Jira assignee를 변경합니다 (dry-run 모드에서는 서버 로그로만 확인)"
                onClick={() => onReassign(event.id, pick)}
              >
                배정
              </button>
            </div>
          </div>
        )}

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
    </aside>
  )
}
