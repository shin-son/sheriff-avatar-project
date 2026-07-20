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
export async function fetchConsoleTail(buildUrl) {
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
