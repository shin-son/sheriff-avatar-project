// Jenkins source adapter — pulls the real failure log from the build linked in
// the Jira ticket. 실티켓 description은 비정형이라 분류·ingest의 로그 근거는
// Jenkins 콘솔이 맡는다 (docs/BACKEND.md F1의 로그 보강 경로).
//
// Read-only REST, Jira와 같은 직접 호출 패턴: GET <buildUrl>/consoleText,
// Basic auth (user + API token). GET에는 CSRF crumb가 필요 없다.
// Works against mock/jenkins-server.mjs (auth 없이) or a real Jenkins via .env:
//   SVP_JENKINS_USER, SVP_JENKINS_TOKEN (+ NODE_EXTRA_CA_CERTS for corporate TLS)

const USER = process.env.SVP_JENKINS_USER
const TOKEN = process.env.SVP_JENKINS_TOKEN
const TIMEOUT_MS = Number(process.env.SVP_JENKINS_TIMEOUT_MS ?? 5000)
// 실패 원인은 로그 끝에 몰린다 → 꼬리만 유지. classifier의 capLog(head 4000+tail
// 2000)와 조합돼도 콘솔 꼬리의 마지막 부분이 항상 프롬프트에 남는 크기.
const TAIL_CHARS = Number(process.env.SVP_JENKINS_LOG_TAIL ?? 6000)

// Jenkins build URL의 고정 형태: .../job/<path>(/job/<sub>...)/<번호>/
// Jira wiki markup([텍스트|url])·괄호·따옴표 앞에서 끊는다.
const BUILD_URL_RE = /https?:\/\/[^\s|\]"'()]+\/job\/[^\s|\]"'()]+?\/\d+\/?/

/** First Jenkins build URL found in the ticket text, or null. */
export function extractBuildUrl(text) {
  return text?.match(BUILD_URL_RE)?.[0] ?? null
}

function auth() {
  return USER && TOKEN
    ? { Authorization: `Basic ${Buffer.from(`${USER}:${TOKEN}`).toString('base64')}` }
    : {}
}

/**
 * GET <buildUrl>/consoleText → tail slice (≤TAIL_CHARS), or null on any
 * failure. Never throws — a dead Jenkins must not break the poll loop; the
 * caller falls back to the description log.
 */
async function fetchConsoleTail(buildUrl) {
  try {
    const url = `${buildUrl.replace(/\/+$/, '')}/consoleText`
    const res = await fetch(url, { headers: auth(), signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`consoleText returned ${res.status}`)
    const text = await res.text()
    return text.length > TAIL_CHARS ? text.slice(-TAIL_CHARS) : text
  } catch (err) {
    const cause = err.cause ? ` (cause: ${err.cause.code ?? err.cause.message ?? err.cause})` : ''
    console.error(`[svp-server] jenkins consoleText failed ${buildUrl}: ${err.message}${cause}`)
    return null
  }
}

// 티켓의 TEST 링크(CI_MAIN_JOB)는 중계 콘솔이다 — 리소스별 CI_TEST 빌드 링크
// (`CI TEST RESULT : <url>`)만 나열되고, 실제 실패 로그는 그 빌드들의 콘솔에 있다.
const TEST_RESULT_RE = /CI TEST RESULT\s*:\s*(https?:\/\/[^\s|\]"'()]+\/job\/[^\s|\]"'()]+?\/\d+\/?)/g

/** GET <buildUrl>/api/json → result ('SUCCESS'|'FAILURE'|'UNSTABLE'...), or null. */
async function buildResult(buildUrl) {
  try {
    const url = `${buildUrl.replace(/\/+$/, '')}/api/json?tree=result`
    const res = await fetch(url, { headers: auth(), signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    return (await res.json()).result ?? null
  } catch {
    return null
  }
}

/**
 * Failure log for the build linked in a ticket → { url, log } or null.
 * The console is the log itself when it has no CI TEST RESULT links; otherwise
 * follow them one hop and keep only failing shards (result !== 'SUCCESS' —
 * 테스트 실패는 UNSTABLE로 찍히기도 한다; result 조회 불능 시 전부 유지).
 */
export async function fetchFailureLog(buildUrl) {
  const main = await fetchConsoleTail(buildUrl)
  if (main === null) return null
  const linked = [...new Set([...main.matchAll(TEST_RESULT_RE)].map((m) => m[1]))]
  if (linked.length === 0) return { url: buildUrl, log: `[jenkins console tail] ${buildUrl}\n${main}` }
  const withResult = await Promise.all(linked.map(async (u) => ({ u, result: await buildResult(u) })))
  const failing = withResult.filter((b) => b.result !== 'SUCCESS')
  const parts = []
  for (const { u } of failing.length > 0 ? failing : withResult) {
    const tail = await fetchConsoleTail(u)
    if (tail !== null) parts.push({ url: u, text: `[jenkins console tail] ${u}\n${tail}` })
  }
  if (parts.length === 0) return { url: buildUrl, log: `[jenkins console tail] ${buildUrl}\n${main}` }
  return { url: parts[0].url, log: parts.map((p) => p.text).join('\n\n') }
}
