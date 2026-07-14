import { BrowserWindow, app, ipcMain } from 'electron'
import { join } from 'path'
import { TEAM } from '@shared/team'
import type { AppState, CIEvent, IssueStatus, Role, SheriffIssue, UserConfig, WsStatus } from '@shared/types'
import { loadUserConfig, saveUserConfig } from './config'
import { route } from './modules/assignment/router'
import { classify } from './modules/classifier'
import { ToastManager } from './modules/notifications/toast'
import { CIWebSocketClient } from './modules/websocket/client'
import { ingestResolvedIssue, lintWiki, queryWiki, recordFeedback } from './modules/wiki'

const issues: SheriffIssue[] = []
const toasts = new ToastManager()
let mainWindow: BrowserWindow | null = null
let wsStatus: WsStatus = 'connecting'
let userConfig: UserConfig

// Members get a small companion window; the sheriff gets the full dashboard.
const WINDOW_SIZE: Record<Role, { width: number; height: number; minWidth: number; minHeight: number }> = {
  member: { width: 420, height: 640, minWidth: 380, minHeight: 520 },
  sheriff: { width: 1180, height: 760, minWidth: 920, minHeight: 600 }
}

function applyWindowMode(role: Role): void {
  if (!mainWindow) return
  const size = WINDOW_SIZE[role]
  mainWindow.setMinimumSize(size.minWidth, size.minHeight)
  mainWindow.setSize(size.width, size.height)
  mainWindow.center()
}

function createMainWindow(): void {
  const size = WINDOW_SIZE[userConfig.role]
  mainWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    autoHideMenuBar: true,
    backgroundColor: '#16120e',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#110d0a', symbolColor: '#a8987f', height: 40 },
    title: 'Sheriff Avatar',
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  mainWindow.on('closed', () => (mainWindow = null))
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function isRelevantTo(issue: SheriffIssue, cfg: UserConfig): boolean {
  return cfg.role === 'sheriff' || issue.assignment.assigneeId === cfg.userId
}

async function handleCIEvent(event: CIEvent): Promise<void> {
  try {
    const wikiRefs = await queryWiki(event)
    const classification = await classify(event, wikiRefs)
    const assignment = route(classification, TEAM)
    const issue: SheriffIssue = {
      event,
      classification,
      assignment,
      status: 'new',
      receivedAt: new Date().toISOString()
    }
    issues.unshift(issue)
    mainWindow?.webContents.send('issue:new', issue)
    if (isRelevantTo(issue, userConfig)) toasts.show(issue)
  } catch (err) {
    console.error('[svp] failed to process CI event', err)
  }
}

app.whenReady().then(() => {
  userConfig = loadUserConfig()
  createMainWindow()

  const wsUrl = process.env.SVP_CI_WS_URL ?? 'ws://localhost:8790'
  const client = new CIWebSocketClient(wsUrl, handleCIEvent, (status) => {
    wsStatus = status
    mainWindow?.webContents.send('ws:status', status)
  })
  client.connect()

  ipcMain.handle('state:get', (): AppState => ({ issues, team: TEAM, user: userConfig, wsStatus }))

  ipcMain.handle('user:set', (_e, userId: string): UserConfig => {
    const member = TEAM.find((m) => m.id === userId)
    if (member) {
      const roleChanged = member.role !== userConfig.role
      userConfig = { userId: member.id, role: member.role }
      saveUserConfig(userConfig)
      if (roleChanged) applyWindowMode(member.role)
    }
    return userConfig
  })

  ipcMain.handle('issue:setStatus', async (_e, id: string, status: IssueStatus) => {
    const issue = issues.find((i) => i.event.id === id)
    if (!issue) return null
    issue.status = status
    if (status === 'resolved') await ingestResolvedIssue(issue)
    mainWindow?.webContents.send('issue:updated', issue)
    return issue
  })

  ipcMain.handle('wiki:lint', () => lintWiki())

  ipcMain.on('wiki:feedback', (_e, noteTitle: string, helpful: boolean) => {
    recordFeedback(noteTitle, helpful)
  })

  ipcMain.on('toast:click', (e, issueId: string) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('issue:focus', issueId)
    }
    BrowserWindow.fromWebContents(e.sender)?.close()
  })

  ipcMain.on('toast:close', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
