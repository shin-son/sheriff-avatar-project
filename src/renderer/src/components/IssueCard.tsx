import { useState } from 'react'
import type { CIEventType, IssueStatus, SheriffIssue } from '@shared/types'
import { formatIssueTime } from '../format'

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

/** One ledger row; click to expand classification detail and actions. */
export default function IssueCard({ issue, highlighted, onSetStatus }: Props) {
  const { event, classification, assignment, status } = issue
  const confClass = classification.confidence > 80 ? 'high' : 'low'
  const [open, setOpen] = useState(false)
  const [voted, setVoted] = useState<Record<string, boolean>>({})
  const expanded = open || highlighted

  const vote = (noteTitle: string, helpful: boolean) => {
    window.svp.wikiFeedback(noteTitle, helpful)
    setVoted((v) => ({ ...v, [noteTitle]: true }))
  }

  return (
    <article
      id={`issue-${event.id}`}
      className={[
        'row',
        `severity-${classification.severity}`,
        highlighted ? 'highlighted' : '',
        expanded ? 'open' : '',
        status === 'new' ? 'is-new' : '',
        status === 'resolved' ? 'is-resolved' : ''
      ].join(' ')}
    >
      <button className="row-line" aria-expanded={expanded} onClick={() => setOpen(!expanded)}>
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

      {expanded && (
        <div className="row-detail">
          <p className="detail-summary">{classification.summary}</p>
          <p className="detail-reason">
            {assignment.routedTo === 'feature-owner' ? '담당자 자동 배정' : '당번 확인 필요'} —{' '}
            {assignment.reason}
          </p>
          {classification.wikiRefs.length > 0 && (
            <div className="wiki-refs">
              {classification.wikiRefs.map((r) => (
                <span key={r.file} className="wiki-ref">
                  {r.title}
                  {voted[r.title] ? (
                    <span className="fb-done">피드백됨</span>
                  ) : (
                    <>
                      <button className="fb-btn" title="이 노트가 도움됨" onClick={() => vote(r.title, true)}>
                        도움됨
                      </button>
                      <button className="fb-btn" title="이 노트는 도움 안 됨" onClick={() => vote(r.title, false)}>
                        도움 안 됨
                      </button>
                    </>
                  )}
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
        </div>
      )}
    </article>
  )
}
