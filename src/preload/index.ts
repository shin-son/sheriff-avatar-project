import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

function subscribe(channel: string, cb: (payload: unknown) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: unknown): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  frameless: process.argv.includes('--svp-frameless'),
  getState: () => ipcRenderer.invoke('state:get'),
  login: (username: string, password: string) => ipcRenderer.invoke('auth:login', username, password),
  ackIssue: (id: string) => ipcRenderer.send('issue:ack', id),
  reassignIssue: (id: string, assigneeId: string) => ipcRenderer.send('issue:reassign', id, assigneeId),
  onIssueNew: (cb: (payload: unknown) => void) => subscribe('issue:new', cb),
  onIssueUpdated: (cb: (payload: unknown) => void) => subscribe('issue:updated', cb),
  onStateRefresh: (cb: (payload: unknown) => void) => subscribe('state:refresh', cb),
  onWsStatus: (cb: (payload: unknown) => void) => subscribe('ws:status', cb),
  onIssueFocus: (cb: (payload: unknown) => void) => subscribe('issue:focus', cb),
  onToastData: (cb: (payload: unknown) => void) => subscribe('toast:data', cb),
  wikiLint: () => ipcRenderer.invoke('wiki:lint'),
  openWiki: (noteTitle?: string) => ipcRenderer.send('wiki:open', noteTitle),
  wikiFeedback: (noteTitle: string, helpful: boolean) => ipcRenderer.send('wiki:feedback', noteTitle, helpful),
  toastClick: (issueId: string) => ipcRenderer.send('toast:click', issueId),
  toastClose: () => ipcRenderer.send('toast:close'),
  winMinimize: () => ipcRenderer.send('window:minimize'),
  winMaximize: () => ipcRenderer.send('window:maximize'),
  winClose: () => ipcRenderer.send('window:close'),
  openTicket: (url: string) => ipcRenderer.send('ticket:open', url),
  setNotificationsMuted: (muted: boolean) => ipcRenderer.invoke('notify:setMuted', muted),
  onNotifyMuted: (cb: (payload: unknown) => void) => subscribe('notify:muted', cb)
}

contextBridge.exposeInMainWorld('svp', api)
