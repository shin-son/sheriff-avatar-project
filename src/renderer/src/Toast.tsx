import { useEffect, useState } from 'react'
import type { SheriffIssue } from '@shared/types'

export default function Toast() {
  const [data, setData] = useState<{ issue: SheriffIssue; confidenceMin: number; userId: string } | null>(null)
  const [rated, setRated] = useState(false)

  useEffect(() => window.svp.onToastData(setData), [])

  if (!data) return null
  const { issue, confidenceMin, userId } = data
  const conf = issue.classification.confidence
  const refs = issue.classification.wikiRefs
  // F8 — 해결 push가 오면 해결 담당자에게 참조 노트 피드백을 즉석 요청한다.
  // 상위 참조 노트 하나는 toast에서 바로 평가, 나머지는 클릭해 상세 패널에서.
  const askFeedback = issue.status === 'resolved' && issue.assignment.assigneeId === userId && refs.length > 0

  const rate = (helpful: boolean): void => {
    window.svp.wikiFeedback(refs[0].title, helpful)
    setRated(true)
    setTimeout(() => window.svp.toastClose(), 1500)
  }

  return (
    <div className="toast" onClick={() => window.svp.toastClick(issue.event.id)}>
      <span className={`star-badge ${conf > confidenceMin ? 'high' : 'low'}`} title={`신뢰도 ${conf}`}>
        <span className="star-num">{conf}</span>
      </span>
      <div className="toast-content">
        <div className="toast-header">
          <span className="toast-app">SHERIFF AVATAR</span>
          <button
            className="toast-close"
            onClick={(e) => {
              e.stopPropagation()
              window.svp.toastClose()
            }}
          >
            ✕
          </button>
        </div>
        <div className="toast-title">{issue.event.title}</div>
        {askFeedback ? (
          <div className="toast-meta">
            {rated ? (
              <span className="toast-fb-done">피드백 반영됨 — 다음 분류가 배웁니다</span>
            ) : (
              <>
                <span className="toast-fb-ask">해결 완료 — 『{refs[0].title}』 노트가 원인과 일치했나요?</span>
                <button
                  className="toast-fb-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    rate(true)
                  }}
                >
                  👍
                </button>
                <button
                  className="toast-fb-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    rate(false)
                  }}
                >
                  👎
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="toast-meta">
            <span className={`toast-route ${issue.assignment.routedTo}`}>
              {issue.assignment.routedTo === 'sheriff' ? '당번 확인 필요' : '자동 배정'}
            </span>
            <span className="toast-assignee">→ {issue.assignment.assigneeName}</span>
          </div>
        )}
      </div>
    </div>
  )
}
