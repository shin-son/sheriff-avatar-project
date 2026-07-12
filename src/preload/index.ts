import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { IssueStatus } from '../shared/types'

function subscribe(channel: string, cb: (payload: unknown) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: unknown): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  getState: () => ipcRenderer.invoke('state:get'),
  setUser: (userId: string) => ipcRenderer.invoke('user:set', userId),
  setIssueStatus: (id: string, status: IssueStatus) => ipcRenderer.invoke('issue:setStatus', id, status),
  onIssueNew: (cb: (payload: unknown) => void) => subscribe('issue:new', cb),
  onIssueUpdated: (cb: (payload: unknown) => void) => subscribe('issue:updated', cb),
  onWsStatus: (cb: (payload: unknown) => void) => subscribe('ws:status', cb),
  onIssueFocus: (cb: (payload: unknown) => void) => subscribe('issue:focus', cb),
  onToastData: (cb: (payload: unknown) => void) => subscribe('toast:data', cb),
  wikiLint: () => ipcRenderer.invoke('wiki:lint'),
  wikiFeedback: (noteTitle: string, helpful: boolean) => ipcRenderer.send('wiki:feedback', noteTitle, helpful),
  toastClick: (issueId: string) => ipcRenderer.send('toast:click', issueId),
  toastClose: () => ipcRenderer.send('toast:close')
}

contextBridge.exposeInMainWorld('svp', api)
