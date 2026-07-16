// Jira write helpers (API.md §2): summary comment, assignee, status transition.
// Callers decide what a failure means — these just throw on non-2xx.
const JIRA = process.env.SVP_JIRA_BASE_URL ?? 'http://localhost:8792'
const PAT = process.env.SVP_JIRA_PAT

function auth() {
  return PAT ? { Authorization: `Bearer ${PAT}` } : {}
}

async function request(path, options = {}) {
  const res = await fetch(`${JIRA}${path}`, {
    ...options,
    headers: { ...auth(), 'Content-Type': 'application/json', ...options.headers }
  })
  if (!res.ok) throw new Error(`${options.method ?? 'GET'} ${path} returned ${res.status}`)
  return res
}

export function postComment(key, body) {
  return request(`/rest/api/2/issue/${key}/comment`, { method: 'POST', body: JSON.stringify({ body }) })
}

export function setAssignee(key, name) {
  return request(`/rest/api/2/issue/${key}/assignee`, { method: 'PUT', body: JSON.stringify({ name }) })
}

/** Transition by name — the mock/jira-server.mjs contract.
 *  TODO(SVP-6): match by statusCategory once the corporate workflow names are confirmed. */
export async function transitionTo(key, statusName) {
  const res = await request(`/rest/api/2/issue/${key}/transitions`)
  const { transitions } = await res.json()
  const target = transitions.find((t) => t.name === statusName)
  if (!target) throw new Error(`no "${statusName}" transition on ${key}`)
  await request(`/rest/api/2/issue/${key}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ transition: { id: target.id } })
  })
}

/** The agreed summary-comment template (API.md §2) — posted once per assignment. */
export function buildComment(event, llm, wikiRefs, assigneeLine, reason) {
  const refs = wikiRefs.length
    ? wikiRefs.map((r) => `  - ${r.title} — ${r.file}`).join('\n')
    : '  - (매칭된 노트 없음)'
  return [
    '🤖 Sheriff Avatar 자동 분석',
    '─────────────────────────',
    `■ 분류: ${llm.category} / ${event.type} / ${llm.severity}`,
    `■ 신뢰도: ${llm.confidence}/100 → ${assigneeLine}`,
    `■ 요약: ${llm.summary}`,
    '■ 참고 (LLM-WIKI):',
    refs,
    `■ 배정 근거: ${reason}`
  ].join('\n')
}
