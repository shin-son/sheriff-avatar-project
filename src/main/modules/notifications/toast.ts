import { BrowserWindow, app, screen } from 'electron'
import { join } from 'path'
import type { SheriffIssue } from '@shared/types'

const WIDTH = 384
const HEIGHT = 136
const MARGIN = 14
const GAP = 10
const TTL_MS = 9000

/** Frameless always-on-top popup windows stacked above the taskbar (bottom-right). */
export class ToastManager {
  private windows: BrowserWindow[] = []

  show(issue: SheriffIssue): void {
    const { workArea } = screen.getPrimaryDisplay()
    const slot = this.windows.length
    const x = workArea.x + workArea.width - WIDTH - MARGIN
    const y = workArea.y + workArea.height - MARGIN - HEIGHT - slot * (HEIGHT + GAP)
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      x,
      y,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      hasShadow: false,
      webPreferences: { preload: join(__dirname, '../preload/index.js') }
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('toast:data', issue)
      win.showInactive()
    })
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/toast.html`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/toast.html'))
    }
    this.windows.push(win)
    const timer = setTimeout(() => {
      if (!win.isDestroyed()) win.close()
    }, TTL_MS)
    win.on('closed', () => {
      clearTimeout(timer)
      this.windows = this.windows.filter((w) => w !== win)
    })
  }
}
