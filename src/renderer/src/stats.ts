// 당번 대시보드 집계 — 서버 변경 없이 클라이언트가 보유한 이슈에서 파생한다.
// 순수 함수(사이드이펙트 없음)라 향후 테스트·재사용이 쉽다.
import type { SheriffIssue } from '@shared/types'

export interface ModuleStat {
  module: string
  sheriffWaiting: number // 당번 대기 (routedTo=sheriff, 미해결)
  autoAssigned: number // 자동 배정 (feature-owner, 미해결)
  resolved: number
  total: number
}

export interface DupGroup {
  signature: string
  module: string
  keys: string[]
}

export interface DashboardStats {
  total: number
  sheriffWaiting: number
  autoAssigned: number
  resolved: number
  critical: number // 미해결 critical 심각도
  modules: ModuleStat[]
  dupGroups: DupGroup[]
  dupIssueCount: number
}

/** 분류기 카테고리가 신뢰 모듈. CI의 module은 fallback (DetailPanel과 동일 규칙). */
function moduleOf(i: SheriffIssue): string {
  const c = i.classification.category
  return c && c !== 'unknown' ? c : i.event.module || 'unknown'
}

/**
 * 스냅샷 중복 판정용 실패 서명. 로그의 'TC name or file : X'를 우선 쓰고,
 * 없으면 제목에서 [..] 접두·Failed 접미를 걷어낸 정규화 문자열로 폴백한다.
 * 추정 신호이므로 exact-match만 사용(오탐 최소화) — 병합 판단은 사람 몫.
 */
export function signatureOf(i: SheriffIssue): string {
  const m = i.event.log?.match(/TC name or file\s*:\s*(\S+)/i)
  if (m) return m[1].toLowerCase()
  return i.event.title
    .replace(/^(\[[^\]]*\]\s*)+/g, '')
    .replace(/\s*[:|-]?\s*(failed|fail)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function deriveStats(issues: SheriffIssue[]): DashboardStats {
  const modules = new Map<string, ModuleStat>()
  const stat = (mod: string): ModuleStat => {
    let s = modules.get(mod)
    if (!s) {
      s = { module: mod, sheriffWaiting: 0, autoAssigned: 0, resolved: 0, total: 0 }
      modules.set(mod, s)
    }
    return s
  }

  let sheriffWaiting = 0
  let autoAssigned = 0
  let resolved = 0
  let critical = 0
  for (const i of issues) {
    const s = stat(moduleOf(i))
    s.total += 1
    if (i.status === 'resolved') {
      resolved += 1
      s.resolved += 1
      continue
    }
    if (i.classification.severity === 'critical') critical += 1
    if (i.assignment.routedTo === 'sheriff') {
      sheriffWaiting += 1
      s.sheriffWaiting += 1
    } else {
      autoAssigned += 1
      s.autoAssigned += 1
    }
  }

  // 스냅샷 중복: 미해결 이슈를 서명으로 묶어 2건 이상인 그룹.
  const bySig = new Map<string, SheriffIssue[]>()
  for (const i of issues) {
    if (i.status === 'resolved') continue
    const sig = signatureOf(i)
    if (!sig) continue
    const arr = bySig.get(sig)
    if (arr) arr.push(i)
    else bySig.set(sig, [i])
  }
  const dupGroups: DupGroup[] = []
  let dupIssueCount = 0
  for (const [signature, arr] of bySig) {
    if (arr.length < 2) continue
    dupGroups.push({
      signature,
      module: moduleOf(arr[0]),
      keys: arr.map((i) => i.event.jira?.key ?? i.event.id)
    })
    dupIssueCount += arr.length
  }
  dupGroups.sort((a, b) => b.keys.length - a.keys.length)

  const openOf = (m: ModuleStat): number => m.sheriffWaiting + m.autoAssigned
  const moduleList = [...modules.values()].sort(
    (a, b) => openOf(b) - openOf(a) || b.total - a.total
  )

  return {
    total: issues.length,
    sheriffWaiting,
    autoAssigned,
    resolved,
    critical,
    modules: moduleList,
    dupGroups,
    dupIssueCount
  }
}
