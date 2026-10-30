import type { AppUpdater } from 'electron-updater'
import { gt, valid } from 'semver'
import type { AppUpdateState } from '../shared/types'

interface Options {
  enabled: boolean
  currentVersion: string
  emit(state: AppUpdateState): void
  canInstall(): boolean
  beforeInstall(): Promise<void>
}

export class UpdateManager {
  private state: AppUpdateState
  private checkPromise: Promise<AppUpdateState> | null = null
  private downloadPromise: Promise<AppUpdateState> | null = null
  private timer?: ReturnType<typeof setTimeout>
  private interval?: ReturnType<typeof setInterval>

  constructor(private updater: AppUpdater, private options: Options) {
    this.state = { status: options.enabled ? 'idle' : 'unsupported', currentVersion: options.currentVersion }
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.autoRunAppAfterInstall = true
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.disableWebInstaller = true
    updater.logger = null
    if (!options.enabled) return

    updater.on('checking-for-update', () => {
      // Keep an available update visible while the next background check runs.
      if (!this.state.version) this.setState({ status: 'checking' })
    })
    updater.on('update-available', info => {
      if (!valid(info.version) || !gt(info.version, options.currentVersion)) { this.setState({ status: 'idle' }); return }
      this.setState({ status: 'available', version: info.version })
    })
    updater.on('update-not-available', () => this.setState({ status: 'idle' }))
    updater.on('download-progress', progress => {
      if (this.state.status !== 'downloading') return
      const percent = Number.isFinite(progress.percent) ? Math.min(100, Math.max(0, Math.round(progress.percent))) : 0
      this.setState({ ...this.state, status: 'downloading', percent })
    })
    updater.on('update-downloaded', info => {
      if (valid(info.version) && gt(info.version, options.currentVersion)) this.setState({ status: 'downloaded', version: info.version, percent: 100 })
    })
    updater.on('error', () => this.fail())
  }

  getState(): AppUpdateState { return { ...this.state } }

  private setState(next: Omit<AppUpdateState, 'currentVersion'>) {
    this.state = { ...next, currentVersion: this.options.currentVersion }
    this.options.emit(this.getState())
  }

  private fail() {
    if (this.state.status === 'installing') return
    const downloading = this.state.status === 'downloading'
    this.setState({ status: 'error', version: this.state.version, error: downloading ? 'Das Update konnte nicht heruntergeladen werden. Bitte versuche es erneut.' : 'Die Updatequelle ist gerade nicht erreichbar. Bitte versuche es später erneut.' })
  }

  start() {
    if (!this.options.enabled || this.timer || this.interval) return
    this.timer = setTimeout(() => { this.timer = undefined; void this.check() }, 8000)
    this.timer.unref?.()
    this.interval = setInterval(() => void this.check(), 60_000)
    this.interval.unref?.()
  }

  dispose() {
    clearTimeout(this.timer); clearInterval(this.interval)
    this.timer = undefined; this.interval = undefined
  }

  async check(): Promise<AppUpdateState> {
    if (!this.options.enabled || ['downloading', 'downloaded', 'installing'].includes(this.state.status)) return this.getState()
    if (this.checkPromise) return this.checkPromise
    this.checkPromise = (async () => {
      try {
        await this.updater.checkForUpdates()
      } catch { this.fail() }
      return this.getState()
    })()
    try { return await this.checkPromise } finally { this.checkPromise = null }
  }

  async download(): Promise<AppUpdateState> {
    if (!this.options.enabled) throw new Error('Automatische Updates sind in der installierten Windows-Version verfügbar.')
    // A minute check can already be in flight when the user clicks Download.
    // Let it finish before transitioning into the download state.
    if (this.checkPromise) await this.checkPromise
    if (this.downloadPromise) return this.downloadPromise
    if (this.state.status === 'downloaded') return this.getState()
    if (!this.state.version || !['available', 'error'].includes(this.state.status)) throw new Error('Es steht kein Update zum Herunterladen bereit.')
    this.setState({ status: 'downloading', version: this.state.version, percent: 0 })
    this.downloadPromise = (async () => {
      try { await this.updater.downloadUpdate() } catch { this.fail() }
      return this.getState()
    })()
    try { return await this.downloadPromise } finally { this.downloadPromise = null }
  }

  async install(): Promise<void> {
    if (!this.options.enabled || this.state.status !== 'downloaded') throw new Error('Das Update ist noch nicht vollständig heruntergeladen.')
    if (!this.options.canInstall()) throw new Error('Koda arbeitet noch. Warte auf die Antwort oder stoppe sie vor dem Neustart.')
    const ready = this.getState()
    this.setState({ ...ready, status: 'installing' })
    try {
      await this.options.beforeInstall()
      if (!this.options.canInstall()) throw new Error('Koda arbeitet noch. Bitte warte vor dem Neustart.')
      this.updater.quitAndInstall(true, true)
    } catch (error) {
      this.setState({ ...ready, status: 'downloaded' })
      throw error
    }
  }
}
