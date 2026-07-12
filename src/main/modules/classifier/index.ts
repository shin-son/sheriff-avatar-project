import type { CIEvent, CIEventType, Classification, IssueSeverity, WikiMatch } from '@shared/types'

const SEVERITY_BY_TYPE: Record<CIEventType, IssueSeverity> = {
  build_failed: 'critical',
  deploy_failed: 'critical',
  test_failed: 'major',
  lint_failed: 'minor'
}

/** Deterministic pseudo-jitter so repeated demo runs look stable. */
function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// TODO(SVP-2): replace this stub with a real LLM call (Claude API).
// The real implementation should send the CI log plus the matched wiki notes
// as context and ask the model for { category, severity, confidence, summary }.
export async function classify(event: CIEvent, wikiRefs: WikiMatch[]): Promise<Classification> {
  const strongMatch = wikiRefs.length > 0 && wikiRefs[0].score >= 3
  const base = strongMatch ? 86 : wikiRefs.length > 0 ? 58 : 34
  const confidence = Math.min(99, base + (hash(event.id) % 10))
  const category = wikiRefs.length > 0 ? event.module : 'unknown'
  const summary = strongMatch
    ? `LLM-WIKI에 유사 사례가 있는 '${category}' 모듈의 ${event.type} 이슈로 분류됨.`
    : `LLM-WIKI에서 확실한 근거를 찾지 못함. 당번의 직접 확인이 필요함.`
  return { category, severity: SEVERITY_BY_TYPE[event.type], confidence, summary, wikiRefs }
}
