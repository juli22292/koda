import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { AppUpdater } from 'electron-updater'
import { UpdateManager } from '../src/main/updates'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  autoRunAppAfterInstall = false
  allowPrerelease = true
  allowDowngrade = true
  disableWebInstaller = false
  logger: unknown = console
  checks = 0
  downloads = 0
  installs: unknown[][] = []
  checkImpl = async () => { this.emit('checking-for-update'); this.emit('update-not-available') }
  downloadImpl = async () => { this.emit('download-progress', { percent: 47.7 }); this.emit('update-downloaded', { version: '0.3.0' }) }
  async checkForUpdates() { this.checks++; return this.checkImpl() }
  async downloadUpdate() { this.downloads++; return this.downloadImpl() }
  quitAndInstall(...args: unknown[]) { this.installs.push(args) }
}
function fixture({ enabled = true, canInstall = () => true, beforeInstall = async () => {} }: { enabled?: boolean; canInstall?: () => boolean; beforeInstall?: () => Promise<void> } = {}) {
  const updater = new FakeUpdater()
  const manager = new UpdateManager(updater as unknown as AppUpdater, { enabled, currentVersion: '0.2.0', emit: () => {}, canInstall, beforeInstall })
  return { updater, manager }
}
test('updates require an installed app and never auto-install on quit', async () => {
  const { updater, manager } = fixture({ enabled: false })
  assert.equal((await manager.check()).status, 'unsupported')
  assert.equal(updater.checks, 0)
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal(updater.allowDowngrade, false)
  await assert.rejects(manager.download(), /installierten/)
  await assert.rejects(manager.install(), /heruntergeladen/)
})
test('only a valid newer version becomes available', () => {
  const { updater, manager } = fixture()
  for (const version of ['invalid', '0.1.0', '0.2.0']) {
    updater.emit('update-available', { version })
    assert.equal(manager.getState().status, 'idle')
  }
  updater.emit('update-available', { version: '0.3.0' })
  assert.equal(manager.getState().status, 'available')
  assert.equal(manager.getState().version, '0.3.0')
})
test('simultaneous checks share one provider request; offline errors can recover', async () => {
  const { updater, manager } = fixture()
  let resolve!: () => void
  updater.checkImpl = () => new Promise<void>(r => { resolve = r })
  const first = manager.check(), second = manager.check()
  assert.equal(updater.checks, 1)
  updater.emit('update-not-available'); resolve()
  await Promise.all([first, second])
  updater.checkImpl = async () => { throw new Error('network unavailable') }
  assert.equal((await manager.check()).status, 'error')
  updater.checkImpl = async () => { updater.emit('update-not-available') }
  assert.equal((await manager.check()).status, 'idle')
})
test('downloads require an available version and are installed only on explicit request', async () => {
  const { updater, manager } = fixture()
  await assert.rejects(manager.download(), /kein Update/)
  updater.emit('update-available', { version: '0.3.0' })
  assert.equal((await manager.download()).status, 'downloaded')
  assert.equal(updater.installs.length, 0)
  assert.equal((await manager.check()).status, 'downloaded')
  assert.equal(updater.checks, 0)
  await manager.install()
  assert.deepEqual(updater.installs, [[true, true]])
})
test('failed downloads preserve the version and can be retried', async () => {
  const { updater, manager } = fixture()
  updater.emit('update-available', { version: '0.3.0' })
  updater.downloadImpl = async () => { throw new Error('checksum mismatch') }
  assert.equal((await manager.download()).status, 'error')
  assert.equal(manager.getState().version, '0.3.0')
  assert.equal(updater.installs.length, 0)
  updater.downloadImpl = async () => { updater.emit('update-downloaded', { version: '0.3.0' }) }
  assert.equal((await manager.download()).status, 'downloaded')
  assert.equal(updater.downloads, 2)
})
test('running tasks and failed persistence prevent a restart', async () => {
  let busy = true, failSave = false, persisted = 0
  const { updater, manager } = fixture({ canInstall: () => !busy, beforeInstall: async () => { if (failSave) throw new Error('save failed'); persisted++ } })
  updater.emit('update-downloaded', { version: '0.3.0' })
  await assert.rejects(manager.install(), /arbeitet noch/)
  assert.equal(persisted, 0)
  busy = false; failSave = true
  await assert.rejects(manager.install(), /save failed/)
  assert.equal(manager.getState().status, 'downloaded')
  assert.equal(updater.installs.length, 0)
  failSave = false
  await manager.install()
  assert.equal(persisted, 1)
  assert.equal(updater.installs.length, 1)
})
test('a new task started while saving still prevents installation', async () => {
  let busy = false
  const { updater, manager } = fixture({ canInstall: () => !busy, beforeInstall: async () => { busy = true } })
  updater.emit('update-downloaded', { version: '0.3.0' })
  await assert.rejects(manager.install(), /arbeitet noch/)
  assert.equal(updater.installs.length, 0)
  assert.equal(manager.getState().status, 'downloaded')
})
