import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { DEFAULT_USER_ID, TEAM } from '@shared/team'
import type { UserConfig } from '@shared/types'

// One JSON store for all local settings (user identity, notification mute, ...).
// Writes merge into the existing file so settings don't clobber each other.

function configPath(): string {
  return join(app.getPath('userData'), 'svp-config.json')
}

function readStore(): Record<string, unknown> {
  try {
    if (existsSync(configPath())) {
      return JSON.parse(readFileSync(configPath(), 'utf-8')) as Record<string, unknown>
    }
  } catch {
    // corrupted store: start fresh
  }
  return {}
}

function writeStore(patch: Record<string, unknown>): void {
  writeFileSync(configPath(), JSON.stringify({ ...readStore(), ...patch }, null, 2))
}

export function loadUserConfig(): UserConfig {
  const raw = readStore()
  const member = TEAM.find((m) => m.id === raw.userId)
  if (member) return { userId: member.id, role: member.role }
  const fallback = TEAM.find((m) => m.id === DEFAULT_USER_ID) ?? TEAM[0]
  return { userId: fallback.id, role: fallback.role }
}

export function saveUserConfig(cfg: UserConfig): void {
  writeStore({ userId: cfg.userId, role: cfg.role })
}

export function loadNotificationsMuted(): boolean {
  return readStore().notificationsMuted === true
}

export function saveNotificationsMuted(muted: boolean): void {
  writeStore({ notificationsMuted: muted })
}
