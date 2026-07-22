// F3 — LLM classifier (docs/API.md §3 contract). Given a normalized CIEvent and
// the top wiki matches, Claude scores the failure 0–100 and names the module.
// Providers:
//   bedrock         — Bedrock Messages 엔드포인트 (Mantle 클라이언트, 신형)
//   bedrock-invoke  — 표준 Bedrock InvokeModel 경로 (구형 — 사내처럼 Mantle이 막힌 환경).
//                     structured output 미지원이라 프롬프트로 JSON을 강제하고 파싱한다.
//   anthropic       — 직접 Anthropic API (사외 dev)
// Every failure path returns the §3 fallback — an LLM outage must never stop
// the pipeline; unclassified tickets simply stay in the sheriff queue.
import { AnthropicBedrock, AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk'
import Anthropic from '@anthropic-ai/sdk'

const PROVIDER = process.env.SVP_LLM_PROVIDER ?? 'bedrock'
const IS_BEDROCK = PROVIDER === 'bedrock' || PROVIDER === 'bedrock-invoke'
const TIMEOUT_MS = Number(process.env.SVP_LLM_TIMEOUT_MS ?? 30000)
// bedrock-invoke 기본값은 global inference profile — on-demand ID(anthropic.claude-opus-4-8)는
// InvokeModel에서 400을 반환하는 것이 사내 Bedrock에서 확인됨. 환경이 다르면 SVP_LLM_MODEL로 교체.
const MODEL =
  process.env.SVP_LLM_MODEL ??
  (PROVIDER === 'bedrock-invoke'
    ? 'global.anthropic.claude-opus-4-8'
    : PROVIDER === 'bedrock'
      ? 'anthropic.claude-opus-4-8'
      : 'claude-opus-4-8')

const SEVERITY_BY_TYPE = {
  build_failed: 'critical',
  deploy_failed: 'critical',
  test_failed: 'major',
  lint_failed: 'minor'
}

let client = null

/** False when no credentials are configured — classify() then falls back instantly. */
export function classifierEnabled() {
  if (IS_BEDROCK) return Boolean(process.env.AWS_REGION)
  return Boolean(process.env.SVP_ANTHROPIC_API_KEY)
}

function getClient() {
  if (client) return client
  const opts = { timeout: TIMEOUT_MS, maxRetries: 1 }
  client =
    PROVIDER === 'bedrock'
      ? new AnthropicBedrockMantle({ awsRegion: process.env.AWS_REGION, ...opts })
      : PROVIDER === 'bedrock-invoke'
        ? new AnthropicBedrock({ awsRegion: process.env.AWS_REGION, ...opts })
        : new Anthropic({ apiKey: process.env.SVP_ANTHROPIC_API_KEY, ...opts })
  return client
}

function fallback(event, reason) {
  return {
    category: 'unknown',
    severity: SEVERITY_BY_TYPE[event.type] ?? 'major',
    confidence: 0,
    summary: `LLM 분류 실패(${reason}) — 당번의 직접 확인이 필요함.`,
    evidence: []
  }
}

/** head+tail cap so one giant CI log can't blow the prompt. */
function capLog(text, head = 4000, tail = 2000) {
  if (text.length <= head + tail) return text
  return `${text.slice(0, head)}\n...(중략)...\n${text.slice(-tail)}`
}

function buildSchema(categories) {
  return {
    type: 'object',
    properties: {
      category: { type: 'string', enum: [...categories, 'unknown'] },
      severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      summary: { type: 'string' },
      evidence: { type: 'array', items: { type: 'string' } }
    },
    required: ['category', 'severity', 'confidence', 'summary', 'evidence'],
    additionalProperties: false
  }
}

function buildSystem(categories) {
  const lines = [
    'You are the CI-failure classifier of Sheriff Avatar, an issue-triage agent.',
    'Given a Jira ticket (from a CI failure) and the team wiki notes that matched it,',
    'classify the failure and score how confidently it can be auto-assigned.',
    '',
    `- "category" must be one of [${categories.join(', ')}] or "unknown". Never invent a module.`,
    '- "confidence" (0-100) must reflect the strength of the WIKI EVIDENCE, not your general',
    '  reasoning. If no provided note describes this failure pattern, confidence MUST be 50 or',
    '  lower and "evidence" empty — 근거 없는 고신뢰 금지. Confidence above 80 means "this matches',
    '  a known-failure in the notes closely enough to assign the owner without sheriff review".',
    '- "evidence": only file paths of provided notes you actually relied on (e.g. "modules/auth.md").',
    '- "summary": 한국어 2~3문장. 담당자가 로그를 열기 전에 상황을 파악할 수 있게 — 무엇이 실패했고,',
    '  어떤 known-failure 패턴과 일치하며(있다면), 예상 원인/해결 방향까지.',
    '- "severity": build/deploy 실패는 critical 성향, test는 major, lint는 minor — 단 내용으로 판단하라.'
  ]
  if (PROVIDER === 'bedrock-invoke') {
    // 표준 Bedrock(InvokeModel)은 structured output 미지원 — 프롬프트로 강제한다.
    lines.push(
      '',
      'Respond with EXACTLY ONE JSON object matching this schema — no prose before or after, no code fences:',
      JSON.stringify(buildSchema(categories))
    )
  }
  return lines.join('\n')
}

/** 모델이 코드펜스/설명을 붙여도 JSON 본체만 건진다 (invoke 경로 + 방어용). */
function extractJson(text = '') {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  return start >= 0 && end > start ? body.slice(start, end + 1) : body
}

function buildUser(event, matches) {
  const notes = matches.length
    ? matches
        .map((m) => `### ${m.file} (score ${m.score})\n${capLog(m.body, 3000, 0)}`)
        .join('\n\n')
    : '(매칭된 노트 없음)'
  return [
    '[티켓]',
    `key: ${event.id}`,
    `summary: ${event.title}`,
    `type: ${event.type}`,
    `module(CI 태깅 힌트 — 틀릴 수 있음): ${event.module}`,
    `branch: ${event.branch}`,
    'description/로그 발췌:',
    capLog(event.log),
    '',
    '[WIKI 노트 (관련도 상위)]',
    notes,
    '',
    '위 티켓을 분류하라.'
  ].join('\n')
}

/**
 * classify(event, matches, modules) → §3 result object. Never throws.
 * `modules` comes from wiki-query listModules() — its module names form the enum.
 */
export async function classify(event, matches, modules) {
  if (!classifierEnabled()) return fallback(event, '자격증명 미설정')
  const categories = modules.map((m) => m.module)
  try {
    const request = {
      model: MODEL,
      max_tokens: 3000,
      system: buildSystem(categories),
      messages: [{ role: 'user', content: buildUser(event, matches) }]
    }
    if (PROVIDER !== 'bedrock-invoke') {
      // 신형 경로에서만: InvokeModel은 이 파라미터들을 거부한다.
      request.thinking = { type: 'adaptive' }
      request.output_config = { format: { type: 'json_schema', schema: buildSchema(categories) } }
    }
    const response = await getClient().messages.create(request)
    const text = response.content.find((b) => b.type === 'text')?.text
    const parsed = JSON.parse(extractJson(text))
    // Belt-and-braces even with structured output: clamp/coerce before acting on it.
    if (!categories.includes(parsed.category)) parsed.category = 'unknown'
    parsed.confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 0)))
    if (!['critical', 'major', 'minor'].includes(parsed.severity)) {
      parsed.severity = SEVERITY_BY_TYPE[event.type] ?? 'major'
    }
    if (!Array.isArray(parsed.evidence)) parsed.evidence = []
    return parsed
  } catch (err) {
    console.error(`[svp-server] classify failed for ${event.id}: ${err.message}`)
    return fallback(event, err.name ?? 'API 오류')
  }
}

/* ── F7 (P0b) — resolution summariser for case-log ingest ─────────────────── */

function resolutionSchema() {
  return {
    type: 'object',
    properties: {
      symptom: { type: 'string' },
      cause: { type: 'string' },
      resolution: { type: 'string' }
    },
    required: ['symptom', 'cause', 'resolution'],
    additionalProperties: false
  }
}

// Non-LLM fallback: keep the symptom from the event; leave cause/resolution
// unknown rather than inventing them (raw/ still holds the original evidence).
function resolutionFallback(event) {
  return { symptom: event.title, cause: '(불명)', resolution: '(불명)' }
}

function buildResolutionSystem() {
  const lines = [
    'You summarise a RESOLVED CI-failure ticket into three fields for the team wiki case-log.',
    'You are given the original failure log and the resolution comments (and a Gerrit patch if present).',
    '',
    '- "symptom": 실패한 테스트 이름·에러 문자열을 원문 그대로. 가공·번역하지 마라.',
    '- "cause": 코멘트/패치에서 확인된 원인. 확정 근거가 없으면 반드시 "추정:"을 앞에 붙여라.',
    '- "resolution": 실제 해결 절차. 패치가 있으면 그 변경을 근거로. 근거가 없으면 "(불명)".',
    '- 한국어로. 주어진 자료에 없는 내용을 지어내지 마라 — LLM이 추정을 사실로 전파하면 안 된다.'
  ]
  if (PROVIDER === 'bedrock-invoke') {
    lines.push(
      '',
      'Respond with EXACTLY ONE JSON object matching this schema — no prose before or after, no code fences:',
      JSON.stringify(resolutionSchema())
    )
  }
  return lines.join('\n')
}

function buildResolutionUser(event, raw) {
  return [
    '[티켓]',
    `key: ${event.id}`,
    `summary: ${event.title}`,
    `type: ${event.type}`,
    `module: ${event.module}`,
    '',
    '[원본 실패 로그]',
    capLog(event.log),
    '',
    '[해결 코멘트]',
    raw.comments?.length ? raw.comments.join('\n---\n') : '(없음)',
    raw.gerritDiff ? `\n[Gerrit 패치 발췌]\n${capLog(raw.gerritDiff, 3000, 0)}` : '',
    '',
    '위 해결된 티켓의 symptom/cause/resolution을 추출하라.'
  ].join('\n')
}

/**
 * summarizeResolution(event, raw) → { symptom, cause, resolution }. Never throws.
 * `raw` = { comments: string[], gerritDiff?: string }. Fills the case-log fields
 * that ingest leaves best-effort; falls back to symptom-only when unavailable.
 */
export async function summarizeResolution(event, raw) {
  if (!classifierEnabled()) return resolutionFallback(event)
  try {
    const request = {
      model: MODEL,
      max_tokens: 2000,
      system: buildResolutionSystem(),
      messages: [{ role: 'user', content: buildResolutionUser(event, raw) }]
    }
    if (PROVIDER !== 'bedrock-invoke') {
      request.output_config = { format: { type: 'json_schema', schema: resolutionSchema() } }
    }
    const response = await getClient().messages.create(request)
    const text = response.content.find((b) => b.type === 'text')?.text
    const parsed = JSON.parse(extractJson(text))
    return {
      symptom: String(parsed.symptom || event.title),
      cause: String(parsed.cause || '(불명)'),
      resolution: String(parsed.resolution || '(불명)')
    }
  } catch (err) {
    console.error(`[svp-server] summarizeResolution failed for ${event.id}: ${err.message}`)
    return resolutionFallback(event)
  }
}
