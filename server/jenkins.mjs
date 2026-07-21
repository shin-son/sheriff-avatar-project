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
// 실측: 샤드 콘솔이 ~9MB — 다운로드 여유를 둔다.
const TIMEOUT_MS = Number(process.env.SVP_JENKINS_TIMEOUT_MS ?? 15000)
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
 * GET <buildUrl>/consoleText → full text, or null on any failure. Never
 * throws — a dead Jenkins must not break the poll loop; the caller falls
 * back to the description log.
 */
async function fetchConsole(buildUrl) {
  try {
    const url = `${buildUrl.replace(/\/+$/, '')}/consoleText`
    const res = await fetch(url, { headers: auth(), signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`consoleText returned ${res.status}`)
    return await res.text()
  } catch (err) {
    const cause = err.cause ? ` (cause: ${err.cause.code ?? err.cause.message ?? err.cause})` : ''
    console.error(`[svp-server] jenkins consoleText failed ${buildUrl}: ${err.message}${cause}`)
    return null
  }
}

function tailOf(text) {
  return text.length > TAIL_CHARS ? text.slice(-TAIL_CHARS) : text
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 샤드 콘솔(~9MB, 수백 TC 직렬 실행)에서 해당 TC의 실행 구간만 추출:
 *   [ENABLE] [191 /380] power-dtm-160.sh   ← 시작 마커
 *   ... Test Result: FAIL / Fail Log: ...  ← 실패 정보는 구간 초반
 * 다음 [ENABLE] 마커 직전(최대 TAIL_CHARS)까지. 티켓의 TC명에는 `linux.` 같은
 * 도메인 접두사가 붙지만 콘솔 마커에는 없다 — 접두사 제거 변형도 시도.
 */
function tcSectionIn(text, tc) {
  if (!tc) return null
  const base = tc.replace(/Link$/, '') // description 렌더링에 따라 'Link' 헤더가 붙어 오는 경우
  for (const name of new Set([base, base.replace(/^[a-z0-9]+\./i, '')])) {
    const m = text.match(new RegExp(`\\[ENABLE\\][^\\n]*${escapeRe(name)}`))
    if (!m) continue
    const next = text.indexOf('[ENABLE]', m.index + m[0].length)
    return text.slice(m.index, Math.min(next === -1 ? text.length : next, m.index + TAIL_CHARS))
  }
  return null
}

// 티켓의 TEST 링크(CI_MAIN_JOB)는 중계 빌드다 — 리소스별 CI_TEST 빌드 링크
// (`CI TEST RESULT : <url>`)는 빌드 description(api/json)에 있고(사내 확인),
// 실제 실패 로그는 그 빌드들의 콘솔에 있다.
const TEST_RESULT_RE = /CI TEST RESULT\s*:\s*(https?:\/\/[^\s|\]"'()<>]+\/job\/[^\s|\]"'()<>]+?\/\d+\/?)/g
const ANY_BUILD_RE = /https?:\/\/[^\s|\]"'()<>]+\/job\/[^\s|\]"'()<>]+?\/\d+\/?/g

/** GET <buildUrl>/api/json → { description?, result? }, or {} on any failure. */
async function buildMeta(buildUrl) {
  try {
    const url = `${buildUrl.replace(/\/+$/, '')}/api/json?tree=description,result`
    const res = await fetch(url, { headers: auth(), signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200).replace(/\s+/g, ' ')
      console.error(`[svp-server] jenkins api/json failed ${buildUrl}: ${res.status} ${body}`)
      return {}
    }
    return await res.json()
  } catch (err) {
    console.error(`[svp-server] jenkins api/json failed ${buildUrl}: ${err.message}`)
    return {}
  }
}

/** GET <buildUrl>/ (HTML build page) → text, or null. api/json 500 폴백용. */
async function fetchPage(buildUrl) {
  try {
    const res = await fetch(buildUrl, { headers: auth(), signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/** 같은 잡의 다른 빌드인지 (빌드 페이지 HTML의 히스토리 링크 제외용). */
function sameJob(a, b) {
  const jobOf = (u) => u.replace(/\/+$/, '').replace(/\/\d+$/, '')
  return jobOf(a) === jobOf(b)
}

/**
 * Shard build links in a relay build's description: `CI TEST RESULT : <url>`
 * 우선, description이 HTML(<a href>)로 감싸 텍스트 패턴이 깨지는 경우엔 모든
 * /job/ 빌드 URL로 폴백. 자기 자신은 제외.
 */
function shardLinksIn(text, selfUrl) {
  const named = [...text.matchAll(TEST_RESULT_RE)].map((m) => m[1])
  const urls = named.length > 0 ? named : (text.match(ANY_BUILD_RE) ?? [])
  const self = selfUrl.replace(/\/+$/, '')
  return [...new Set(urls)].filter((u) => u.replace(/\/+$/, '') !== self)
}

/**
 * Failure log for the build linked in a ticket → { url, log } or null.
 * Shard links are read from the relay build's description (api/json), falling
 * back to its console (잡 구성에 따라 콘솔에 찍는 경우). No links → the console
 * IS the log. With links, keep only failing shards (result !== 'SUCCESS' —
 * 테스트 실패는 UNSTABLE로 찍히기도 한다; result 조회 불능 시 전부 유지).
 * `tc`(티켓의 TC name or file)가 주어지면 그 TC의 실행 구간을 찾은 샤드가
 * 정답이다 — 구간을 못 찾은 샤드들은 꼬리로 폴백.
 */
export async function fetchFailureLog(buildUrl, tc) {
  const meta = await buildMeta(buildUrl)
  let linked = shardLinksIn(meta.description ?? '', buildUrl)
  if (linked.length === 0 && meta.description === undefined) {
    // 사내 사례: api/json은 500인데 빌드 페이지(HTML)는 열리고 description의
    // CI TEST RESULT 링크도 보인다 — 페이지에서 긁되, 같은 잡의 다른 빌드
    // (히스토리 링크)는 제외한다.
    const page = await fetchPage(buildUrl)
    if (page) linked = shardLinksIn(page, buildUrl).filter((u) => !sameJob(u, buildUrl))
  }
  let main = null
  if (linked.length === 0) {
    main = await fetchConsole(buildUrl)
    if (main === null) return null
    linked = [...new Set([...main.matchAll(TEST_RESULT_RE)].map((m) => m[1]))]
    if (linked.length === 0) return { url: buildUrl, log: `[jenkins console tail] ${buildUrl}\n${tailOf(main)}` }
  }
  const withResult = await Promise.all(linked.map(async (u) => ({ u, result: (await buildMeta(u)).result ?? null })))
  const failing = withResult.filter((b) => b.result !== 'SUCCESS')
  const parts = []
  for (const { u } of failing.length > 0 ? failing : withResult) {
    const text = await fetchConsole(u)
    if (text === null) continue
    const section = tcSectionIn(text, tc)
    if (section) return { url: u, log: `[jenkins tc log] ${u}\n${section}` }
    parts.push({ url: u, text: `[jenkins console tail] ${u}\n${tailOf(text)}` })
  }
  if (parts.length === 0) {
    main = main ?? (await fetchConsole(buildUrl))
    return main === null ? null : { url: buildUrl, log: `[jenkins console tail] ${buildUrl}\n${tailOf(main)}` }
  }
  return { url: parts[0].url, log: parts.map((p) => p.text).join('\n\n') }
}
