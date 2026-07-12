import { findSheriff } from '@shared/team'
import type { Assignment, Classification, TeamMember } from '@shared/types'

export const CONFIDENCE_THRESHOLD = 80

/**
 * confidence > 80  → feature (ip) owner of the classified module
 * confidence ≤ 80  → sheriff (당번), human-in-the-loop
 */
export function route(classification: Classification, team: TeamMember[]): Assignment {
  const sheriff = findSheriff(team)
  if (classification.confidence > CONFIDENCE_THRESHOLD) {
    const owner = team.find((m) => m.ownedModules.includes(classification.category))
    if (owner) {
      return {
        assigneeId: owner.id,
        assigneeName: owner.name,
        routedTo: 'feature-owner',
        reason: `신뢰도 ${classification.confidence}점(>${CONFIDENCE_THRESHOLD}) — '${classification.category}' 담당자에게 자동 배정`
      }
    }
  }
  const reason =
    classification.confidence > CONFIDENCE_THRESHOLD
      ? `'${classification.category}' 담당자를 찾지 못해 당번에게 배정`
      : `신뢰도 ${classification.confidence}점(≤${CONFIDENCE_THRESHOLD}) — 당번 확인 필요 (human-in-the-loop)`
  return { assigneeId: sheriff.id, assigneeName: sheriff.name, routedTo: 'sheriff', reason }
}
