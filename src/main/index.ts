import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { Store } from './store'
import { Agent, fetchModels } from './agent'
import { listWorkspaceFiles, readWorkspaceFile, isSensitive } from './workspace'
import electronUpdater from 'electron-updater'
import { UpdateManager } from './updates'
import type { ChatRequest, ProviderId } from '../shared/types'

app.setName('Koda')
if (process.env.KODA_USER_DATA) app.setPath('userData', process.env.KODA_USER_DATA)
const store = new Store()
let window: BrowserWindow
let agent: Agent
let updates: UpdateManager
const validSender = (event: Electron.IpcMainEvent | IpcMainInvokeEvent) => window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
function handle(channel: string, callback: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!validSender(event)) throw new Error('Zugriff verweigert.')
    return callback(...args)
  })
}
function projectPath(id: string) {
  const project = store.data.projects.find(p => p.id === id)
  if (!project) throw new Error('Bitte einen Projektordner öffnen.')
  return project.path
}
function registerIPC() {
  handle('updates:get', () => updates.getState())
  handle('updates:check', () => updates.check())
  handle('updates:download', () => updates.download())
  handle('updates:install', () => updates.install())
  handle('settings:get', () => store.publicSettings())
  handle('settings:save', patch => store.saveSettings(patch))
  handle('provider:save', (id, config) => store.saveProvider(id, config))
  handle('provider:remove-key', id => store.removeKey(id))
  handle('provider:test', async (id: ProviderId) => {
    const config = store.publicSettings().providers.find(p => p.id === id)
    if (!config) throw new Error('Unbekannter Anbieter.')
    const models = await fetchModels(config, store.key(id))
    await store.setModels(id, models)
    return { models }
  })
  handle('data:get', () => store.data)
  handle('data:save', data => store.saveData(data))
  handle('project:open', async () => {
    const selected = await dialog.showOpenDialog(window, { title: 'Projektordner öffnen', properties: ['openDirectory'] })
    if (selected.canceled || !selected.filePaths[0]) return null
    const root = await fs.realpath(selected.filePaths[0])
    const existing = store.data.projects.find(p => p.path.toLowerCase() === root.toLowerCase())
    const project = { id: existing?.id || crypto.randomUUID(), path: root, name: path.basename(root), lastOpened: Date.now() }
    await store.registerProject(project)
    return project
  })
  handle('project:list', (id, relativePath) => listWorkspaceFiles(projectPath(id), relativePath))
  handle('project:read', (id, relativePath) => readWorkspaceFile(projectPath(id), relativePath))
  handle('files:pick', async () => {
    const selected = await dialog.showOpenDialog(window, { title: 'Textdateien als Kontext hinzufügen', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Code & Text', extensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'md', 'txt', 'py', 'css', 'html', 'rs', 'go', 'yaml', 'yml', 'toml', 'csv', 'sql', 'sh', 'vue', 'svelte', 'c', 'cpp', 'java'] }] })
    if (selected.canceled) return []
    return Promise.all(selected.filePaths.slice(0, 10).map(async target => {
      if (isSensitive(path.basename(target))) throw new Error('Dateien mit Zugangsdaten können nicht angehängt werden.')
      const stat = await fs.stat(target)
      if (stat.size > 150000) throw new Error(`${path.basename(target)} ist größer als 150 KB.`)
      const content = await fs.readFile(target, 'utf8')
      if (content.includes('\0')) throw new Error('Bitte eine Textdatei wählen.')
      return { name: path.basename(target), content, path: target }
    }))
  })
  handle('chat:start', (request: ChatRequest) => { void agent.start(request).catch(error => window.webContents.send('chat:event', { type: 'error', requestId: request.requestId, error: error.message })) })
  handle('chat:stop', id => agent.stop(id))
  handle('chat:approve', (requestId, toolId, approved) => agent.approve(requestId, toolId, approved))
  handle('external:open', async (url: string) => {
    const parsed = new URL(url)
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Dieser Linktyp wird nicht unterstützt.')
    const { response } = await dialog.showMessageBox(window, { type: 'question', title: 'Link im Browser öffnen', message: parsed.hostname, detail: url.slice(0, 500), buttons: ['Öffnen', 'Abbrechen'], cancelId: 1, defaultId: 0 })
    if (response === 0) await shell.openExternal(parsed.href)
  })
  handle('chat:export', async (title: string, markdown: string) => {
    const result = await dialog.showSaveDialog(window, { title: 'Chat exportieren', defaultPath: `${title.replace(/[<>:"/\\|?*]/g, '').slice(0, 80) || 'Koda-Chat'}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (result.canceled || !result.filePath) return false
    await fs.writeFile(result.filePath, markdown, 'utf8')
    return true
  })
  ipcMain.on('window:action', (event, action) => {
    if (!validSender(event)) return
    if (action === 'minimize') window.minimize()
    else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize()
    else if (action === 'close') window.close()
  })
}
async function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 960, minHeight: 680,
    title: 'Koda', backgroundColor: '#faf9f6', frame: false, show: false,
    icon: nativeImage.createFromPath(path.join(__dirname, '../../resources/icon.png')),
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  })
  agent = new Agent(store, event => { if (!window.isDestroyed()) window.webContents.send('chat:event', event) })
  updates = new UpdateManager(electronUpdater.autoUpdater, {
    enabled: app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR,
    currentVersion: app.getVersion(),
    emit: state => { if (!window.isDestroyed()) window.webContents.send('updates:state', state) },
    canInstall: () => !agent.isRunning,
    beforeInstall: () => store.flush(),
  })
  registerIPC()
  // Native shortcuts must be intercepted before Chromium or Electron's menu
  // can reload the renderer and detach it from a running agent.
  window.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r')) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.once('ready-to-show', () => window.show())
  window.on('close', () => agent.stopAll())
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(path.join(__dirname, '../renderer/index.html'))
  updates.start()
}
app.whenReady().then(async () => {
  try { Menu.setApplicationMenu(null); await store.load(); await createWindow() } catch (error) { dialog.showErrorBox('Koda konnte nicht starten', error instanceof Error ? error.message : String(error)); app.quit() }
})
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => updates?.dispose())
