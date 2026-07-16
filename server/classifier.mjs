// F3 — LLM classifier (docs/API.md §3 contract). Given a normalized CIEvent and
// the top wiki matches, Claude scores the failure 0–100 and names the module.
// Providers: AWS Bedrock (사내, default) or the direct Anthropic API (사외 dev).
// Every failure path returns the §3 fallback — an LLM outage must never stop
// the pipeline; unclassified tickets simply stay in the sheriff queue.
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk'
import Anthropic from '@anthropic-ai/sdk'

const PROVIDER = process.env.SVP_LLM_PROVIDER ?? 'bedrock'
const TIMEOUT_MS = Number(process.env.SVP_LLM_TIMEOUT_MS ?? 30000)
const MODEL =
  process.env.SVP_LLM_MODEL ?? (PROVIDER === 'bedrock' ? 'anthropic.claude-opus-4-8' : 'claude-opus-4-8')

const SEVERITY_BY_TYPE = {
  build_failed: 'critical',
  deploy_failed: 'critical',
  test_failed: 'major',
  lint_failed: 'minor'
}

let client = null

/** False when no credentials are configured — classify() then falls back instantly. */
export function classifierEnabled() {
  if (PROVIDER === 'bedrock') return Boolean(process.env.AWS_REGION)
  return Boolean(process.env.SVP_ANTHROPIC_API_KEY)
}

function getClient() {
  if (client) return client
  client =
    PROVIDER === 'bedrock'
      ? new AnthropicBedrockMantle({ awsRegion: process.env.AWS_REGION, timeout: TIMEOUT_MS, maxRetries: 1 })
      : new Anthropic({ apiKey: process.env.SVP_ANTHROPIC_API_KEY, timeout: TIMEOUT_MS, maxRetries: 1 })
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
  return [
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
  ].join('\n')
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
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 3000,
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: buildSchema(categories) } },
      system: buildSystem(categories),
      messages: [{ role: 'user', content: buildUser(event, matches) }]
    })
    const text = response.content.find((b) => b.type === 'text')?.text
    const parsed = JSON.parse(text)
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
