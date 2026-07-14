/** "HH:MM" for today's issues, "M/D HH:MM" for older ones. */
export function formatIssueTime(timestamp: string): string {
  const d = new Date(timestamp)
  const time = d.toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.getMonth() + 1}/${d.getDate()} ${time}`
}
