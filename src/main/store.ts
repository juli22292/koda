import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppData, ModelCapabilities, ProviderId, Settings } from '../shared/types'
import { defaultSettings, PROVIDERS } from '../shared/providers'
import { normalizeEffort } from '../shared/effort'
import { restoreInterruptedActivities } from '../shared/activity-time'

interface DiskSettings extends Settings { secrets: Partial<Record<ProviderId, string>> }
export class Store {
  private settings: DiskSettings = { ...defaultSettings(), secrets: {} }
  data: AppData = { projects: [], conversations: [] }
  private queue: Promise<unknown> = Promise.resolve()
  private get directory() { return app.getPath('userData') }
  async load() {
    await fs.mkdir(this.directory, { recursive: true })
    try {
      const disk = JSON.parse(await fs.readFile(path.join(this.directory, 'settings.json'), 'utf8')) as DiskSettings
      this.settings = { ...this.settings, ...disk, providers: PROVIDERS.map(p => ({ ...defaultSettings().providers.find(d => d.id === p.id)!, ...disk.providers?.find(d => d.id === p.id) })) }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Die Einstellungen konnten nicht gelesen werden. Die vorhandene Datei bleibt erhalten.') }
    try { this.data = restoreInterruptedActivities(JSON.parse(await fs.readFile(path.join(this.directory, 'workspace.json'), 'utf8'))) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Der Chatverlauf konnte nicht gelesen werden. Die vorhandene Datei bleibt erhalten.') }
  }
  private write(name: string, value: unknown) {
    const serialized = JSON.stringify(value, null, 2)
    const operation = this.queue.catch(() => {}).then(async () => {
      const target = path.join(this.directory, name)
      const temporary = `${target}.tmp`
      await fs.writeFile(temporary, serialized, { mode: 0o600 })
      await fs.rename(temporary, target)
    })
    this.queue = operation
    return operation
  }
  publicSettings(): Settings {
    const { secrets, ...settings } = this.settings
    return structuredClone({ ...settings, providers: settings.providers.map(p => ({ ...p, hasKey: !!secrets[p.id] })) })
  }
  async flush() { await this.queue }
  key(id: ProviderId): string {
    const encrypted = this.settings.secrets[id]
    if (!encrypted) return ''
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Die Windows-Schlüsselverschlüsselung ist nicht verfügbar.')
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  }
  async saveSettings(patch: Partial<Omit<Settings, 'providers'>>) {
    if (patch.theme && ['light', 'dark', 'system'].includes(patch.theme)) this.settings.theme = patch.theme
    if (patch.defaultProvider && PROVIDERS.some(p => p.id === patch.defaultProvider)) this.settings.defaultProvider = patch.defaultProvider
    if (typeof patch.systemPrompt === 'string') this.settings.systemPrompt = patch.systemPrompt.slice(0, 12000)
    if (typeof patch.fontSize === 'number') this.settings.fontSize = Math.min(18, Math.max(12, patch.fontSize))
    if (patch.effortPreferences && typeof patch.effortPreferences === 'object') {
      const preferences = { ...this.settings.effortPreferences }
      for (const [key, value] of Object.entries(patch.effortPreferences).slice(0, 300)) {
        const separator = key.indexOf(':')
        const provider = key.slice(0, separator) as ProviderId, model = key.slice(separator + 1)
        if (separator > 0 && model.length <= 200 && PROVIDERS.some(item => item.id === provider)) preferences[key] = normalizeEffort(provider, model, value, this.settings.providers.find(item => item.id === provider))
      }
      this.settings.effortPreferences = Object.fromEntries(Object.entries(preferences).slice(-300))
    }
    await this.write('settings.json', this.settings)
    return this.publicSettings()
  }
  async saveProvider(id: ProviderId, config: { model: string; baseURL: string; apiKey?: string }) {
    const current = this.settings.providers.find(p => p.id === id)
    if (!current) throw new Error('Unbekannter Anbieter.')
    const endpoint = new URL(config.baseURL)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
    if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && local)) throw new Error('Der Endpoint muss HTTPS verwenden. Lokale Endpoints dürfen HTTP verwenden.')
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Der Endpoint darf keine Zugangsdaten oder URL-Parameter enthalten.')
    if (typeof config.model !== 'string' || config.model.length > 200) throw new Error('Ungültige Modell-ID.')
    // Branded providers never send a saved key to a user-supplied host.
    if (id !== 'custom' && endpoint.origin !== new URL(PROVIDERS.find(p => p.id === id)!.baseURL).origin) throw new Error('Für eigene Endpoints bitte „Eigener Anbieter“ verwenden.')
    if (config.apiKey?.trim() || current.baseURL !== config.baseURL.replace(/\/+$/, '')) { current.models = []; current.modelCapabilities = {} }
    if (config.apiKey?.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('API-Keys können ohne Windows-Verschlüsselung nicht gespeichert werden.')
      this.settings.secrets[id] = safeStorage.encryptString(config.apiKey.trim()).toString('base64')
    }
    current.model = config.model.trim()
    current.baseURL = config.baseURL.replace(/\/+$/, '')
    await this.write('settings.json', this.settings)
    return this.publicSettings().providers.find(p => p.id === id)!
  }
  async removeKey(id: ProviderId) {
    delete this.settings.secrets[id]
    const config = this.settings.providers.find(p => p.id === id)!
    config.models = []
    config.modelCapabilities = {}
    await this.write('settings.json', this.settings)
    return this.publicSettings().providers.find(p => p.id === id)!
  }
  async setModels(id: ProviderId, models: string[], capabilities: Record<string, ModelCapabilities> = {}) {
    const provider = this.settings.providers.find(p => p.id === id)!
    provider.models = models
    provider.modelCapabilities = Object.fromEntries(models.filter(model => capabilities[model] || provider.modelCapabilities?.[model]).map(model => [model, { ...provider.modelCapabilities?.[model], ...capabilities[model] }]))
    await this.write('settings.json', this.settings)
  }
  async setModelCapabilities(id: ProviderId, model: string, capabilities: ModelCapabilities) {
    const provider = this.settings.providers.find(p => p.id === id)!
    provider.modelCapabilities = { ...provider.modelCapabilities, [model]: { ...provider.modelCapabilities?.[model], ...capabilities } }
    await this.write('settings.json', this.settings)
  }
  async saveData(data: AppData) {
    if (!Array.isArray(data.conversations) || !Array.isArray(data.projects)) throw new Error('Ungültige Workspace-Daten.')
    // Only a native folder selection can register a project path.
    // Keep the main-process registry, including folders selected while an older autosave was in flight.
    this.data = { projects: this.data.projects, conversations: data.conversations.slice(0, 500) }
    await this.write('workspace.json', this.data)
  }
  async registerProject(project: AppData['projects'][number]) {
    this.data.projects = [project, ...this.data.projects.filter(p => p.id !== project.id)]
    await this.write('workspace.json', this.data)
  }
}
