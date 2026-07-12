import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { DEFAULT_USER_ID, TEAM } from '@shared/team'
import type { UserConfig } from '@shared/types'

function configPath(): string {
  return join(app.getPath('userData'), 'svp-config.json')
}

export function loadUserConfig(): UserConfig {
  try {
    if (existsSync(configPath())) {
      const raw = JSON.parse(readFileSync(configPath(), 'utf-8')) as UserConfig
      if (TEAM.some((m) => m.id === raw.userId)) return raw
    }
  } catch {
    // fall through to default
  }
  const member = TEAM.find((m) => m.id === DEFAULT_USER_ID) ?? TEAM[0]
  return { userId: member.id, role: member.role }
}

export function saveUserConfig(cfg: UserConfig): void {
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2))
}
