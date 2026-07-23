import { config as loadDotenv } from 'dotenv'
import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, shell } from 'electron'
import { join } from 'path'

// Local config from <project root>/.env (gitignored) — shell env vars still win.
// NODE_EXTRA_CA_CERTS is the one exception: Node reads it at process start, so it
// cannot come from .env (see docs/SETUP.md).
loadDotenv({ quiet: true })
import type { AppState, Role, SheriffIssue, TeamMember, UserConfig, WsStatus } from '@shared/types'
import { loadNotificationsMuted, saveNotificationsMuted } from './config'
import { ToastManager } from './modules/notifications/toast'
import { createPushListener } from './modules/push'
import type { PushListener, PushSession } from './modules/push'
import { lintWiki, recordFeedback, vaultDir } from './modules/wiki'

// v3 client (docs/arch-v3-server-split): the app is a pure client. Login
// establishes the session; the server decides role/issues and pushes them.
// No local Jira polling, hub, or status writes — Jira (via the server) is
// the source of truth for everything, including issue status.

const issues: SheriffIssue[] = []
const toasts = new ToastManager()
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let wsStatus: WsStatus = 'disconnected'
let notificationsMuted = false
let authed = false
// Placeholder until login — the login window uses the compact (member) size.
let userConfig: UserConfig = { userId: '', role: 'member' }
let team: TeamMember[] = []
let pushListener: PushListener | null = null
let sessionStartedAt = 0

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

function setWsStatus(status: WsStatus): void {
  wsStatus = status
  mainWindow?.webContents.send('ws:status', status)
}

// Upsert an issue pushed by the server into local state: the renderer
// re-renders via issue:new / issue:updated, and relevant issues pop a toast.
// The login replay burst and server-restart re-pushes (issue.restored) stay
// quiet — those are restored, not new.
function applyPushedIssue(issue: SheriffIssue): void {
  const idx = issues.findIndex((i) => i.event.id === issue.event.id)
  if (idx === -1) issues.unshift(issue)
  else issues[idx] = issue
  mainWindow?.webContents.send(idx === -1 ? 'issue:new' : 'issue:updated', issue)
  const replaying = Date.now() - sessionStartedAt < 3000
  if (!notificationsMuted && !replaying && !issue.restored && isRelevantTo(issue, userConfig))
    toasts.show(issue)
}

// Login = opening the push session. The server authenticates the credentials,
// answers with { user, team } (role decides the view), then replays the
// session's visible unresolved issues as issue:new.
function connectAndLogin(username: string, password: string): Promise<PushSession> {
  return new Promise((resolve, reject) => {
    pushListener?.dispose()
    const url = process.env.SVP_PUSH_URL ?? 'http://localhost:8793'
    let settled = false
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      fn()
    }
    const timeout = setTimeout(
      () =>
        settle(() => {
          listener.dispose()
          pushListener = null
          reject(new Error('서버에 연결할 수 없습니다 — 서버 상태를 확인하세요'))
        }),
      8000
    )
    const listener = createPushListener(url, { username, password }, {
      onSession: (session) => {
        sessionStartedAt = Date.now()
        settle(() => resolve(session))
      },
      onAuthError: () => {
        pushListener = null
        settle(() => reject(new Error('아이디 또는 비밀번호가 올바르지 않습니다')))
      },
      onIssueNew: applyPushedIssue,
      onIssueUpdated: applyPushedIssue,
      onStatus: setWsStatus
    })
    listener.connect()
    pushListener = listener
  })
}

app.whenReady().then(() => {
  notificationsMuted = loadNotificationsMuted()
  createMainWindow()
  createTray()

  ipcMain.handle(
    'state:get',
    (): AppState => ({ issues, team, user: userConfig, wsStatus, notificationsMuted, authed })
  )

  ipcMain.handle('auth:login', async (_e, username: string, password: string) => {
    try {
      const session = await connectAndLogin(String(username ?? '').trim(), String(password ?? ''))
      userConfig = session.user
      team = session.team
      authed = true
      issues.splice(0, issues.length) // fresh session — the server replays what we should see
      applyWindowMode(userConfig.role)
      mainWindow?.webContents.send('state:refresh')
      console.log(`[svp] logged in as ${userConfig.userId} (${userConfig.role})`)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // "티켓 확인" — never flips status locally. The server transitions the Jira
  // ticket; the new status comes back through polling as issue:updated.
  ipcMain.on('issue:ack', (_e, issueId: string) => {
    pushListener?.ackIssue(issueId)
  })

  ipcMain.handle('notify:setMuted', (_e, muted: boolean): boolean => {
    setNotificationsMuted(muted)
    return notificationsMuted
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
