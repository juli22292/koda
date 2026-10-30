const { _electron: electron } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { createHash } = require('node:crypto')
const semver = require('semver')
const pkg = require('../package.json')

async function until(check, message, timeout = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    try { if (await check()) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 60))
  }
  throw new Error(message)
}
const nextVersion = semver.inc(pkg.version, 'patch')
const fixtureBytes = Buffer.alloc(1024 * 1024, 65)
fixtureBytes.write('MZ-Koda-test-payload-do-not-execute')
const sha512 = createHash('sha512').update(fixtureBytes).digest('base64')
let publishedVersion = pkg.version, offline = false, corrupt = true
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/latest.yml')) {
    if (offline) { res.writeHead(503); res.end('offline'); return }
    res.writeHead(200, { 'Content-Type': 'application/yaml' })
    res.end(`version: ${publishedVersion}\nfiles:\n  - url: Koda-Setup-${publishedVersion}-x64.exe\n    sha512: ${sha512}\n    size: ${fixtureBytes.length}\npath: Koda-Setup-${publishedVersion}-x64.exe\nsha512: ${sha512}\nreleaseDate: 2026-10-30T00:00:00.000Z\n`)
    return
  }
  if (req.url.endsWith('.exe')) {
    const payload = Buffer.from(fixtureBytes)
    if (corrupt) payload[100] = 66
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': payload.length })
    let offset = 0
    const interval = setInterval(() => {
      res.write(payload.subarray(offset, offset + 65536)); offset += 65536
      if (offset >= payload.length) { clearInterval(interval); res.end() }
    }, 80)
    res.on('close', () => clearInterval(interval)); return
  }
  if (req.url === '/v1/chat/completions') {
    for await (const _ of req) {}
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ id: 'busy-test', object: 'chat.completion.chunk', model: 'test', created: 1, choices: [{ index: 0, delta: { role: 'assistant', content: 'Ich arbeite noch …' }, finish_reason: null }] })}\n\n`)
    const interval = setInterval(() => res.write(': ping\n\n'), 1000)
    res.on('close', () => clearInterval(interval)); return
  }
  res.writeHead(404); res.end()
})

;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'koda-update-e2e-'))
  const userData = path.join(directory, 'data'), configPath = path.join(directory, 'test-update.yml')
  await fs.writeFile(configPath, `provider: generic\nurl: ${url}\nupdaterCacheDirName: koda-test-cache\n`)
  await fs.mkdir('artifacts', { recursive: true })
  const env = { ...process.env, KODA_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE; delete env.PORTABLE_EXECUTABLE_DIR
  let app, page
  const errors = []
  try {
    app = await electron.launch({ executablePath: path.resolve(process.env.KODA_TEST_EXE || 'release/win-unpacked/Koda.exe'), args: [], env })
    page = await app.firstWindow(); page.setDefaultTimeout(30000)
    page.on('pageerror', error => errors.push(error.message))
    await page.locator('.welcome h1').waitFor()
    await app.evaluate(async ({ app }, { url, configPath, directory }) => {
      const updater = process.mainModule.require('electron-updater').autoUpdater
      updater.updateConfigPath = configPath
      Object.defineProperty(updater.app, 'baseCachePath', { value: directory })
      updater.setFeedURL({ provider: 'generic', url })
      updater.disableDifferentialDownload = true
    }, { url, configPath, directory })

    assert.equal(await page.locator('.titlebar-update').count(), 0)
    assert.equal((await page.evaluate(() => window.koda.checkForUpdates())).status, 'idle')
    assert.equal(await page.locator('.titlebar-update').count(), 0)
    offline = true
    assert.equal((await page.evaluate(() => window.koda.checkForUpdates())).status, 'error')
    assert.equal(await page.locator('.titlebar-update').count(), 0)
    console.log('PASS no icon for current version or offline check')

    offline = false; publishedVersion = nextVersion
    assert.equal((await page.evaluate(() => window.koda.checkForUpdates())).status, 'available')
    const download = page.getByRole('button', { name: `Update ${nextVersion} herunterladen`, exact: true })
    await download.waitFor()
    assert.equal(await download.evaluate(element => element.nextElementSibling.getAttribute('aria-label')), 'Fenster minimieren')
    await page.locator('.titlebar').screenshot({ animations: 'disabled', path: 'artifacts/update-available.png' })
    await download.click()
    await page.getByRole('button', { name: /Update wird geladen:/ }).waitFor()
    await until(async () => (await page.evaluate(() => window.koda.getUpdateState())).status === 'error', 'Bad checksum was not rejected')
    await page.getByRole('button', { name: 'Update erneut herunterladen', exact: true }).waitFor()
    console.log('PASS update icon position, real download and checksum rejection')

    corrupt = false
    await page.getByRole('button', { name: 'Update erneut herunterladen', exact: true }).click()
    await page.getByRole('button', { name: /Update wird geladen:/ }).waitFor()
    await until(async () => (await page.evaluate(() => window.koda.getUpdateState())).status === 'downloaded', 'Valid download did not finish')
    assert.equal(await page.getByRole('button', { name: 'Update installieren und neu starten', exact: true }).isEnabled(), true)
    await page.locator('.titlebar').screenshot({ animations: 'disabled', path: 'artifacts/update-ready.png' })
    console.log('PASS retry, verified download and restart-ready icon')

    await page.evaluate(async url => { await window.koda.saveProvider('custom', { model: 'test', baseURL: `${url}/v1` }); await window.koda.saveSettings({ theme: 'dark' }) }, url)
    await page.reload()
    await page.locator('.welcome h1').waitFor()
    await page.getByRole('textbox', { name: 'Nachricht an Koda' }).fill('Laufende Testaufgabe')
    await page.getByRole('button', { name: 'Nachricht senden' }).click()
    await page.getByText('Ich arbeite noch …', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Update bereit – nach der laufenden Antwort neu starten', exact: true }).isDisabled(), true)
    const blocked = await page.evaluate(() => window.koda.installUpdate().then(() => '', error => error.message))
    assert.match(blocked, /arbeitet noch/)
    await page.getByRole('button', { name: 'Antwort stoppen' }).click()
    await page.getByText('Antwort gestoppt', { exact: true }).waitFor()
    console.log('PASS backend and UI prevent update restart during a running chat')

    // Capture the explicit install request without executing the fixture payload or restarting the machine.
    await app.evaluate(async ({ app }) => {
      const updater = process.mainModule.require('electron-updater').autoUpdater
      updater.quitAndInstall = (silent, forceRun) => { updater.kodaTestInstall = { silent, forceRun } }
    })
    await page.getByRole('textbox', { name: 'Nachricht an Koda' }).fill('Mein Entwurf vor dem Update')
    await page.getByRole('button', { name: 'Update installieren und neu starten', exact: true }).click()
    await until(() => app.evaluate(async ({ app }) => {
      return process.mainModule.require('electron-updater').autoUpdater.kodaTestInstall?.forceRun === true
    }), 'Explicit install was not forwarded')
    const disk = JSON.parse(await fs.readFile(path.join(userData, 'workspace.json'), 'utf8'))
    assert.equal(disk.conversations.length, 1)
    await page.reload()
    await until(() => page.getByRole('textbox', { name: 'Nachricht an Koda' }).inputValue().then(value => value === 'Mein Entwurf vor dem Update'), 'Draft was not restored')
    assert.equal(await page.locator('.message.user').count(), 1)
    assert.deepEqual(errors, [])
    console.log(`PASS chat persistence and draft restoration before explicit installation\nUPDATE E2E COMPLETE: local feed and isolated data at ${directory}`)
  } catch (error) {
    if (page) { console.error((await page.locator('body').innerText().catch(() => '')).slice(-3000)); await page.screenshot({ path: 'artifacts/update-failure.png', animations: 'disabled' }).catch(() => {}) }
    throw error
  } finally {
    if (app) await app.close()
    server.closeAllConnections(); server.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
