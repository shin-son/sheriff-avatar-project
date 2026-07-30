import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

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

export function loadNotificationsMuted(): boolean {
  return readStore().notificationsMuted === true
}

export function saveNotificationsMuted(muted: boolean): void {
  writeStore({ notificationsMuted: muted })
}
