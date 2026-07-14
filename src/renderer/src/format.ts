import type { CIEventType } from '@shared/types'

export const TYPE_LABEL: Record<CIEventType, string> = {
  test_failed: 'TEST FAILED',
  build_failed: 'BUILD FAILED',
  lint_failed: 'LINT FAILED',
  deploy_failed: 'DEPLOY FAILED'
}

/** "HH:MM" for today's issues, "M/D HH:MM" for older ones. */
export function formatIssueTime(timestamp: string): string {
  const d = new Date(timestamp)
  const time = d.toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.getMonth() + 1}/${d.getDate()} ${time}`
}
