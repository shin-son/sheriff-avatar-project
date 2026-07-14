import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, shell } from 'electron'
import { join } from 'path'
import { TEAM } from '@shared/team'
import type { AppState, CIEvent, IssueStatus, Role, SheriffIssue, UserConfig, WsStatus } from '@shared/types'
import { loadNotificationsMuted, loadUserConfig, saveNotificationsMuted, saveUserConfig } from './config'
import { route } from './modules/assignment/router'
import { classify } from './modules/classifier'
import { JiraPoller } from './modules/jira/poller'
import { ToastManager } from './modules/notifications/toast'
import { CIWebSocketClient } from './modules/websocket/client'
import { ingestResolvedIssue, lintWiki, queryWiki, recordFeedback, vaultDir } from './modules/wiki'

const issues: SheriffIssue[] = []
const toasts = new ToastManager()
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let wsStatus: WsStatus = 'connecting'
let notificationsMuted = false
let userConfig: UserConfig

// Members get a small companion window; the sheriff gets the full dashboard.
const WINDOW_SIZE: Record<Role, { width: number; height: number; minWidth: number; minHeight: number }> = {
  member: { width: 420, height: 640, minWidth: 380, minHeight: 520 },
  sheriff: { width: 1440, height: 700, minWidth: 1080, minHeight: 560 }
}

function applyWindowMode(role: Role): void {
  if (!mainWindow) return
  const size = WINDOW_SIZE[role]
  mainWindow.setMinimumSize(size.minWidth, size.minHeight)
  mainWindow.setSize(size.width, size.height)
  mainWindow.center()
}

// Acrylic (desktop blur-behind) needs Windows 11; older builds fall back to a solid theme color.
function supportsAcrylic(): boolean {
  if (process.platform !== 'win32') return false
  const build = Number(process.getSystemVersion().split('.')[2] ?? 0)
  return build >= 22000
}

// Default chrome: transparent frameless window — panels float directly over the
// desktop with a fully custom silhouette (no drag-resize/snap: Windows disables
// thickFrame on transparent windows). SVP_GLASS=acrylic switches to the standard
// window with desktop blur-behind.
type GlassMode = 'frameless' | 'acrylic' | 'solid'

function glassMode(): GlassMode {
  if (process.env.SVP_GLASS === 'acrylic') return supportsAcrylic() ? 'acrylic' : 'solid'
  return 'frameless'
}

function windowChrome(mode: GlassMode): Electron.BrowserWindowConstructorOptions {
  if (mode === 'frameless') return { transparent: true, frame: false, backgroundColor: '#00000000' }
  if (mode === 'acrylic')
    return { titleBarStyle: 'hidden', backgroundMaterial: 'acrylic', backgroundColor: '#00000000' }
  return { titleBarStyle: 'hidden', backgroundColor: '#161618' }
}

function createMainWindow(): void {
  const size = WINDOW_SIZE[userConfig.role]
  const mode = glassMode()
  console.log(`[svp] glass mode: ${mode} (SVP_GLASS=${process.env.SVP_GLASS ?? '<unset>'})`)
  mainWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    autoHideMenuBar: true,
    ...windowChrome(mode),
    title: 'Sheriff Avatar',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      additionalArguments: mode === 'frameless' ? ['--svp-frameless'] : []
    }
  })
  // Close hides to the tray so the agent keeps receiving issues; quit via tray menu.
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => (mainWindow = null))
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showMainWindow(): void {
  if (!mainWindow) {
    createMainWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function setNotificationsMuted(muted: boolean): void {
  notificationsMuted = muted
  saveNotificationsMuted(muted)
  updateTrayMenu()
  mainWindow?.webContents.send('notify:muted', muted)
}

function updateTrayMenu(): void {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: '열기', click: showMainWindow },
      {
        label: notificationsMuted ? '알림 켜기' : '알림 끄기',
        click: () => setNotificationsMuted(!notificationsMuted)
      },
      { type: 'separator' },
      {
        label: '종료',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
}

function createTray(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png')
  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('Sheriff Avatar')
  tray.on('double-click', showMainWindow)
  updateTrayMenu()
}

function isRelevantTo(issue: SheriffIssue, cfg: UserConfig): boolean {
  return cfg.role === 'sheriff' || issue.assignment.assigneeId === cfg.userId
}

let jiraPoller: JiraPoller | null = null

// Team decision: Jira polling runs only where the app acts as the server (sheriff).
// Members never poll Jira themselves — they receive issues via push. Called on
// startup and whenever the role changes ('user:set').
function syncJiraPoller(): void {
  if (userConfig.role === 'sheriff' && !jiraPoller) {
    jiraPoller = new JiraPoller(
      {
        baseUrl: process.env.SVP_JIRA_BASE_URL ?? 'http://localhost:8792',
        project: process.env.SVP_JIRA_PROJECT ?? 'CIOPS',
        label: process.env.SVP_JIRA_LABEL ?? 'ci-failure',
        pollMs: Number(process.env.SVP_JIRA_POLL_MS ?? 30000),
        pat: process.env.SVP_JIRA_PAT,
        storePath: join(app.getPath('userData'), 'svp-processed-tickets.json')
      },
      handleCIEvent
    )
    jiraPoller.start()
  } else if (userConfig.role !== 'sheriff' && jiraPoller) {
    jiraPoller.dispose()
    jiraPoller = null
    console.log('[svp:jira] poller stopped (member role does not poll)')
  }
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
    if (!notificationsMuted && isRelevantTo(issue, userConfig)) toasts.show(issue)
  } catch (err) {
    console.error('[svp] failed to process CI event', err)
  }
}

app.whenReady().then(() => {
  userConfig = loadUserConfig()
  notificationsMuted = loadNotificationsMuted()
  createMainWindow()
  createTray()

  const wsUrl = process.env.SVP_CI_WS_URL ?? 'ws://localhost:8790'
  const client = new CIWebSocketClient(wsUrl, handleCIEvent, (status) => {
    wsStatus = status
    mainWindow?.webContents.send('ws:status', status)
  })
  client.connect()

  // F1 — Jira polling is the main issue inflow (sheriff only); the CI WebSocket
  // above stays as a dev-only path until fully replaced (ARCHITECTURE.md).
  syncJiraPoller()

  ipcMain.handle(
    'state:get',
    (): AppState => ({ issues, team: TEAM, user: userConfig, wsStatus, notificationsMuted })
  )

  ipcMain.handle('notify:setMuted', (_e, muted: boolean): boolean => {
    setNotificationsMuted(muted)
    return notificationsMuted
  })

  ipcMain.handle('user:set', (_e, userId: string): UserConfig => {
    const member = TEAM.find((m) => m.id === userId)
    if (member) {
      const roleChanged = member.role !== userConfig.role
      userConfig = { userId: member.id, role: member.role }
      saveUserConfig(userConfig)
      if (roleChanged) applyWindowMode(member.role)
      syncJiraPoller()
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

  // Window controls live in the renderer title bar (titleBarStyle: 'hidden').
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())

  ipcMain.on('ticket:open', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })

  ipcMain.on('wiki:feedback', (_e, noteTitle: string, helpful: boolean) => {
    recordFeedback(noteTitle, helpful)
  })

  // Open the vault (or one note) in Obsidian; falls back to the OS default
  // (Explorer / .md editor) when the obsidian:// protocol isn't registered.
  ipcMain.on('wiki:open', (_e, noteTitle?: string) => {
    const target = noteTitle ? join(vaultDir(), noteTitle) : vaultDir()
    const uri = `obsidian://open?path=${encodeURIComponent(target)}`
    shell.openExternal(uri).catch(() => void shell.openPath(target))
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

app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => {
  app.quit()
})
