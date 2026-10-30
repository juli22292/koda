import type { AppData, KodaBridge, Settings } from '../../shared/types'
import { defaultSettings } from '../../shared/providers'

// Browser preview stores appearance and chat metadata only. Keys and native operations require Electron.
const previewOnly = async (): Promise<never> => { throw new Error('Diese Funktion ist in der Koda-Desktop-App verfügbar.') }
const read = <T>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback } catch { return fallback } }
const previewSettings = (): Settings => {
  const saved = read<Settings>('koda-preview-settings', defaultSettings())
  return { ...saved, providers: defaultSettings().providers.map(provider => ({ ...provider, ...saved.providers?.find(item => item.id === provider.id) })) }
}
const preview: KodaBridge = {
  desktop: false,
  getUpdateState: async () => ({ status: 'unsupported', currentVersion: __APP_VERSION__ }),
  checkForUpdates: async () => ({ status: 'unsupported', currentVersion: __APP_VERSION__ }),
  downloadUpdate: previewOnly, installUpdate: previewOnly,
  onUpdateState: () => () => {},
  getSettings: async () => previewSettings(),
  saveSettings: async patch => {
    const settings = { ...previewSettings(), ...patch }
    localStorage.setItem('koda-preview-settings', JSON.stringify(settings))
    return settings
  },
  saveProvider: previewOnly, removeKey: previewOnly, testProvider: previewOnly,
  getData: async () => read<AppData>('koda-preview-data', { projects: [], conversations: [] }),
  saveData: async data => { localStorage.setItem('koda-preview-data', JSON.stringify(data)) },
  openProject: previewOnly, listFiles: previewOnly, readFile: previewOnly, revealArtifact: previewOnly, pickFiles: previewOnly,
  startChat: previewOnly, stopChat: previewOnly, approveTool: previewOnly,
  onChatEvent: () => () => {}, windowAction: () => {},
  openExternal: async url => { if (/^https?:\/\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer') },
  exportChat: async (title, markdown) => {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${title}.md`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  },
}
export const bridge = window.koda ?? preview
