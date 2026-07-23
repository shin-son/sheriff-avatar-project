// Jenkins source adapter — pulls the real failure log from the build linked in
// the Jira ticket. 실티켓 description은 비정형이라 분류·ingest의 로그 근거는
// Jenkins 콘솔이 맡는다 (docs/BACKEND.md F1의 로그 보강 경로).
//
// Read-only REST, Jira와 같은 직접 호출 패턴: GET <buildUrl>/consoleText,
// Basic auth (user + API token). GET에는 CSRF crumb가 필요 없다.
// Works against mock/jenkins-server.mjs (auth 없이) or a real Jenkins via .env:
//   SVP_JENKINS_USER, SVP_JENKINS_TOKEN (+ NODE_EXTRA_CA_CERTS for corporate TLS)

import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

const USER = process.env.SVP_JENKINS_USER
const TOKEN = process.env.SVP_JENKINS_TOKEN
// 실측: 샤드 콘솔이 ~9MB — 다운로드 여유를 둔다.
const TIMEOUT_MS = Number(process.env.SVP_JENKINS_TIMEOUT_MS ?? 15000)
// 꼬리 폴백(TC 구간을 못 찾아 콘솔 전체 꼬리를 쓸 때)의 유지 크기 — 콘솔은
// ~9MB라 여기서는 cap이 필수. TC 구간은 통짜 보존이 원칙이라 이 cap과 무관.
const TAIL_CHARS = Number(process.env.SVP_JENKINS_LOG_TAIL ?? 6000)
// TC 구간 안전 상한 — 실측 구간은 30~110KB(마지막 TC + teardown 포함)로 통짜
// 보존이 원칙. 증거는 온전히 보존하고 요약은 소비처(classifier capLog)가 한다.
// 마커 이후 잔여가 병리적으로 클 때만 머리+꼬리로 압축하는 방어선.
const SECTION_MAX = 500_000

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
 * 직통 GET → { ok, status, text }. fetch(undici)가 아니라 node:http를 쓰는
 * 이유: Bedrock 때문에 NODE_USE_ENV_PROXY=1로 서버를 띄우는 사내 환경에서
 * fetch는 사내 프록시를 타고, 프록시는 내부 Jenkins IP를 차단(500 HTML)한다.
 * Jenkins는 항상 사내 내부 — 프록시 설정과 무관하게 무조건 직통으로 간다.
 */
function rawGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(
      u,
      { headers: auth(), timeout: TIMEOUT_MS },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: Buffer.concat(chunks).toString('utf-8')
          })
        )
      }
    )
    req.on('timeout', () => req.destroy(new Error(`timeout after ${TIMEOUT_MS}ms idle`)))
    req.on('error', reject)
    req.end()
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** GET with one retry after backoff — 순간 장애·간헐 차단 대비. */
async function jenkinsGet(url) {
  try {
    const res = await rawGet(url)
    if (res.ok) return res
  } catch {
    // network error — retry below
  }
  await sleep(1500)
  return rawGet(url)
}

/**
 * true if the build URL answers HTTP at all (any status) — 접근 불가(호스트
 * 다운·타임아웃·차단망)만 false. 404/500도 '접근 가능'이다: 그 처리(폴백)는
 * fetch 로직이 맡는다. 죽은 링크에 스킬/콘솔 fetch를 태우지 않기 위한 사전 점검.
 */
export async function probeBuildUrl(buildUrl) {
  try {
    await jenkinsGet(buildUrl)
    return true
  } catch {
    return false
  }
}

/**
 * GET <buildUrl>/consoleText → full text, or null on any failure. Never
 * throws — a dead Jenkins must not break the poll loop; the caller falls
 * back to the description log.
 */
async function fetchConsole(buildUrl) {
  try {
    const res = await jenkinsGet(`${buildUrl.replace(/\/+$/, '')}/consoleText`)
    if (!res.ok) throw new Error(`consoleText returned ${res.status}`)
    return res.text
  } catch (err) {
    const cause = err.code ? ` (cause: ${err.code})` : ''
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
    const section = text.slice(m.index, next === -1 ? text.length : next)
    if (section.length <= SECTION_MAX) return section
    // 안전 상한 초과 시에만 머리+꼬리 — 'Test Result: FAIL' / 'Fail Log:'
    // 판정은 구간 끝에 찍히므로 꼬리를 두껍게 남긴다.
    const head = Math.floor(SECTION_MAX / 3)
    const tail = SECTION_MAX - head
    return `${section.slice(0, head)}\n...(중략 ${section.length - SECTION_MAX} chars)...\n${section.slice(-tail)}`
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
    const res = await jenkinsGet(url)
    if (!res.ok) {
      const body = res.text.slice(0, 200).replace(/\s+/g, ' ')
      console.error(`[svp-server] jenkins api/json failed ${buildUrl}: ${res.status} ${body}`)
      return {}
    }
    return JSON.parse(res.text)
  } catch (err) {
    console.error(`[svp-server] jenkins api/json failed ${buildUrl}: ${err.message}`)
    return {}
  }
}

/** GET <buildUrl>/ (HTML build page) → text, or null. api/json 500 폴백용. */
async function fetchPage(buildUrl) {
  try {
    const res = await jenkinsGet(buildUrl)
    return res.ok ? res.text : null
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
  // 병렬 버스트가 게이트웨이 차단을 부른다 — 샤드 메타는 직렬로 조회.
  const withResult = []
  for (const u of linked) withResult.push({ u, result: (await buildMeta(u)).result ?? null })
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
