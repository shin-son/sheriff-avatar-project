import { useState } from 'react'
import type { CandidateAssignee, SheriffIssue, TeamMember } from '@shared/types'
import { TYPE_LABEL, formatIssueTime } from '../format'
import { moduleOf } from '../stats'

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
  // Feedback loop (CLAUDE.md wiki 규칙): 담당자의 노트 유용성 투표. 한 이슈에서
  // 노트당 1회 — 저장은 main의 feedback store, lint가 부정 누적을 읽는다.
  const [voted, setVoted] = useState<Record<string, boolean>>({})
  const vote = (noteTitle: string, helpful: boolean) => {
    window.svp.wikiFeedback(noteTitle, helpful)
    setVoted((v) => ({ ...v, [noteTitle]: helpful }))
  }

  // Module owners first in the picker (wiki frontmatter → TeamMember.ownedModules).
  // moduleOf: 분류 category 우선, CI module은 fallback (표시·검색·현황 공통 규칙).
  const module = moduleOf(issue)
  const isOwner = (m: TeamMember) => m.ownedModules.includes(module)
  const teamCandidates = team
    .filter((m) => m.role === 'member')
    .sort((a, b) => Number(isOwner(b)) - Number(isOwner(a)))

  // 서버가 내려준 candidates(Gerrit 커미터 등 더 강한 신호)를 우선 사용한다.
  // 없고 confidence ≤ 80(당번 큐)이면 wiki 담당자 신호로 합성해, 서버 데이터와
  // 무관하게 항상 클릭 가능한 후보 버튼을 보여준다.
  const smartCandidates: CandidateAssignee[] = issue.candidates?.length
    ? issue.candidates
    : classification.confidence <= 80
      ? teamCandidates.filter(isOwner).map((m) => ({
          id: m.id,
          name: m.name,
          source: 'wiki' as const,
          reason: `LLM-WIKI ${module} 모듈 담당자`
        }))
      : []

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
            {smartCandidates.length > 0 ? (
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
                <button
                  className="btn candidate-assign-btn"
                  disabled={!pick || pick === assignment.assigneeId}
                  title="Jira assignee를 변경합니다 (dry-run 모드에서는 서버 로그로만 확인)"
                  onClick={() => onReassign(event.id, pick)}
                >
                  선택한 담당자로 배정
                </button>
              </div>
            ) : (
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
            )}
          </div>
        )}

        {classification.wikiRefs.length > 0 && (
          <div className="detail-section">
            <div className="detail-label">참고 (LLM-WIKI)</div>
            {/* 평가는 해결 확정 후에만 — 결과를 알고 나서야 노트가 옳은 근거였는지
                판단할 수 있다 (feedback loop, CLAUDE.md wiki 규칙). */}
            {status === 'resolved' && (
              <p className="fb-prompt">해결 완료 — 참고된 노트가 분류에 도움됐는지 평가해주세요</p>
            )}
            {classification.wikiRefs.map((r) => (
              <div key={r.file} className="detail-ref">
                <span className="ref-title">{r.title}</span>
                {status === 'resolved' &&
                  (voted[r.title] === undefined ? (
                    <span className="ref-fb">
                      <button
                        className="fb-btn"
                        title="이 노트가 분류에 도움됨"
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
                  ))}
              </div>
            ))}
          </div>
        )}

        <div className="detail-section detail-meta">
          {module} · {event.branch} · {formatIssueTime(event.timestamp)}
        </div>
      </div>
    </aside>
  )
}
