// Ticket normalization — the SVP-6 real corporate description contract,
// extracted from index.mjs so the parsing is unit-testable (index.mjs starts
// the server on import). Pure functions only — no I/O, no env.

// 실티켓 description은 HTML로 온다 (사내 실측: <h2>헤드라인</h2><ul><li>key : value</li>...).
// 블록 태그를 줄바꿈으로 바꾸고 태그를 걷어내 줄 단위 계약 파싱이 동작하게 한다.
// plain text에는 매칭될 태그가 없어 그대로 통과 — 두 형식 모두 처리된다.
export function htmlToText(s) {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(h\d|li|ul|ol|p|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&quot;/g, "'")
}

// Real corporate description contract (SVP-6) — ` : `-separated key-value lines:
//   [DEV_CICD][<project>][T<seq>] : <TC명> Failed   ← first line (= summary)
//   CICD Project : ... / Step : TEST / Category : ... / TC name or file : ...
//   Link / CICD : <대시보드 URL> / TEST : <Jenkins 빌드 URL> / IMAGE·DUMP DIR : ...
// description에 실패 로그는 없다 — 로그는 poll()의 Jenkins consoleText 보강이 맡는다.
const STEP_TO_TYPE = {
  TEST: 'test_failed',
  BUILD: 'build_failed',
  DEPLOY: 'deploy_failed',
  LINT: 'lint_failed'
}

export function normalize(t, jiraBase) {
  const text = htmlToText(t.fields.description ?? '')
  const fields = {}
  for (const line of text.split('\n')) {
    const sep = line.indexOf(' : ')
    if (sep > 0) fields[line.slice(0, sep).trim()] = line.slice(sep + 3).trim()
  }
  return {
    id: t.key,
    type: STEP_TO_TYPE[(fields['Step'] ?? '').toUpperCase()] ?? 'test_failed',
    title: t.fields.summary,
    module: 'unknown', // description에 모듈 정보 없음 — LLM 분류가 결정
    branch: fields['CICD Project'] ?? '',
    log: text,
    url: fields['CICD'] ?? `${jiraBase}/browse/${t.key}`,
    timestamp: t.fields.created,
    source: 'jira',
    jira: { key: t.key, url: `${jiraBase}/browse/${t.key}`, status: t.fields.status.statusCategory.key }
  }
}
