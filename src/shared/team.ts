import type { TeamMember } from './types'

// TODO(SVP-1): load from server / settings instead of hardcoding.
export const TEAM: TeamMember[] = [
  { id: 'alice', name: 'Alice (A)', role: 'member', ownedModules: ['auth', 'login'] },
  { id: 'bob', name: 'Bob (B)', role: 'member', ownedModules: ['payment', 'billing'] },
  { id: 'carol', name: 'Carol (C)', role: 'sheriff', ownedModules: ['infra'] }
]

export const DEFAULT_USER_ID = 'carol'

export function findSheriff(team: TeamMember[]): TeamMember {
  const sheriff = team.find((m) => m.role === 'sheriff')
  if (!sheriff) throw new Error('Team must have exactly one sheriff')
  return sheriff
}
