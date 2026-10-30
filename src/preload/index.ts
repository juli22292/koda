import { contextBridge, ipcRenderer } from 'electron'
import type { AppUpdateState, ChatEvent, KodaBridge } from '../shared/types'

const bridge: KodaBridge = {
  desktop: true,
  getUpdateState: () => ipcRenderer.invoke('updates:get'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateState: callback => {
    const listener = (_: unknown, state: AppUpdateState) => callback(state)
    ipcRenderer.on('updates:state', listener)
    return () => ipcRenderer.removeListener('updates:state', listener)
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  saveProvider: (id, config) => ipcRenderer.invoke('provider:save', id, config),
  removeKey: id => ipcRenderer.invoke('provider:remove-key', id),
  testProvider: id => ipcRenderer.invoke('provider:test', id),
  getData: () => ipcRenderer.invoke('data:get'),
  saveData: data => ipcRenderer.invoke('data:save', data),
  openProject: () => ipcRenderer.invoke('project:open'),
  listFiles: (id, path) => ipcRenderer.invoke('project:list', id, path),
  readFile: (id, path) => ipcRenderer.invoke('project:read', id, path),
  revealArtifact: (id, path) => ipcRenderer.invoke('artifact:reveal', id, path),
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  startChat: request => ipcRenderer.invoke('chat:start', request),
  stopChat: requestId => ipcRenderer.invoke('chat:stop', requestId),
  approveTool: (requestId, toolId, approved) => ipcRenderer.invoke('chat:approve', requestId, toolId, approved),
  onChatEvent: callback => {
    const listener = (_: unknown, event: ChatEvent) => callback(event)
    ipcRenderer.on('chat:event', listener)
    return () => ipcRenderer.removeListener('chat:event', listener)
  },
  windowAction: action => ipcRenderer.send('window:action', action),
  openExternal: url => ipcRenderer.invoke('external:open', url),
  exportChat: (title, markdown) => ipcRenderer.invoke('chat:export', title, markdown),
}
contextBridge.exposeInMainWorld('koda', bridge)
