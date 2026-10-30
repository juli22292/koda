const { _electron: electron } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')

async function until(check, message, timeout = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try { if (await check()) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 60))
  }
  throw new Error(message)
}
const requests = []
const availableModels = ['koda-test', 'koda-fast', 'koda-reasoning', ...Array.from({ length: 9 }, (_, index) => `koda-model-${index + 1}`)]
let modelResponse = availableModels
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: modelResponse.map(id => ({ id })) })); return
  }
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  requests.push(body)
  const lastUserIndex = body.messages.findLastIndex(message => message.role === 'user')
  const user = String(body.messages[lastUserIndex].content)
  const tools = body.messages.slice(lastUserIndex + 1).filter(message => message.role === 'tool')
  if (user.includes('__error__')) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error' } })); return }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'chat-test', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'koda-test', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
  const text = content => { chunk({ role: 'assistant', content }); chunk({}, 'stop'); res.write('data: [DONE]\n\n'); res.end() }
  const call = (name, args) => { chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call-${tools.length}-${requests.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }); chunk({}, 'tool_calls'); res.write('data: [DONE]\n\n'); res.end() }
  if (user.includes('__slow__')) {
    let interval
    const initial = setTimeout(() => {
      chunk({ role: 'assistant', content: 'Eine lange Antwort ' })
      interval = setInterval(() => chunk({ content: 'läuft weiter … ' }), 150)
    }, 1800)
    res.on('close', () => { clearTimeout(initial); clearInterval(interval) }); return
  }
  if (user.includes('__workflow__')) {
    if (tools.length === 0) return call('list_files', { path: '.' })
    if (tools.length === 1) return call('read_file', { path: 'hello.txt' })
    if (tools.length === 2) return call('write_file', { path: 'hello.txt', content: 'Hallo von Koda.\n' })
    if (tools.length === 3) return call('run_command', { command: "Write-Output 'koda-terminal-ok'", explanation: 'Prüft die lokale Befehlsausführung.' })
    return text('Die Datei wurde aktualisiert und der Befehl erfolgreich ausgeführt.\n\n```ts\nconst ready = true\n```')
  }
  if (user.includes('__deny__')) {
    if (!tools.length) return call('write_file', { path: 'hello.txt', content: 'NICHT SCHREIBEN' })
    return text('Die Änderung wurde abgelehnt. Deine Datei bleibt erhalten.')
  }
  if (user.includes('__ask__')) return text('Im Fragen-Modus lese ich dein Projekt, ohne Änderungen vorzunehmen.')
  return text('Hallo! Die Verbindung zu deinem lokalen Testanbieter funktioniert.')
})

;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'koda-e2e-'))
  const projectPath = path.join(directory, 'testprojekt')
  const dataPath = path.join(directory, 'data')
  await fs.mkdir(projectPath)
  await fs.writeFile(path.join(projectPath, 'hello.txt'), 'Original\n')
  await fs.writeFile(path.join(projectPath, 'context.ts'), 'export const context = 42\n')
  await fs.mkdir('artifacts', { recursive: true })
  const env = { ...process.env, KODA_USER_DATA: dataPath }; delete env.ELECTRON_RUN_AS_NODE
  let app, page
  const errors = []
  try {
    app = await electron.launch({ executablePath: process.env.KODA_TEST_EXE ? path.resolve(process.env.KODA_TEST_EXE) : require('electron'), args: process.env.KODA_TEST_EXE ? [] : [path.resolve('.')], env })
    page = await app.firstWindow(); page.setDefaultTimeout(30000)
    page.on('pageerror', error => errors.push(error.message))
    await page.getByRole('heading', { name: 'Was bauen wir heute?' }).waitFor()
    await page.evaluate(() => document.fonts.ready)
    assert.equal(await page.evaluate(() => window.koda.desktop), true)
    await page.screenshot({ animations: 'disabled', path: 'artifacts/home.png' })
    console.log('PASS native startup and home')

    await page.locator('.sidebar-settings').click()
    await page.getByLabel('API-Key', { exact: true }).fill('sk-koda-test-do-not-use')
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()
    await page.getByText('Einstellungen gespeichert.', { exact: true }).waitFor()
    const disk = await fs.readFile(path.join(dataPath, 'settings.json'), 'utf8')
    assert.equal(disk.includes('sk-koda-test-do-not-use'), false)
    const publicSettings = await page.evaluate(() => window.koda.getSettings())
    assert.equal(JSON.stringify(publicSettings).includes('sk-koda-test-do-not-use'), false)
    assert.equal('secrets' in publicSettings, false)
    assert.equal(publicSettings.providers[0].hasKey, true)
    await page.getByRole('button', { name: 'API-Key entfernen', exact: true }).click()
    await page.getByRole('button', { name: 'Entfernen', exact: true }).click()
    await until(async () => !(await page.evaluate(() => window.koda.getSettings())).providers[0].hasKey, 'Key was not removed')
    console.log('PASS DPAPI encryption, key isolation and removal')

    await page.getByRole('tab', { name: 'Eigener', exact: true }).click()
    await page.getByLabel('Modell-ID', { exact: true }).fill('koda-test')
    await page.getByLabel('API-Endpoint', { exact: true }).fill(`http://127.0.0.1:${port}/v1`)
    await page.getByRole('button', { name: 'Verbindung prüfen', exact: true }).click()
    await page.getByText('Verbindung steht. 12 Modelle verfügbar.').waitFor()
    await until(() => page.locator('.available-models').evaluate(element => {
      const panel = element.closest('.settings-content').getBoundingClientRect()
      const list = element.getBoundingClientRect()
      return list.top >= panel.top && list.bottom <= panel.bottom + 1
    }), 'Discovered models were not brought into view')
    assert.equal(await page.locator('.available-model-option').count(), 12)
    await page.screenshot({ animations: 'disabled', path: 'artifacts/available-models.png' })
    await page.getByRole('searchbox', { name: 'Verfügbare Modelle durchsuchen' }).fill('koda-fast')
    assert.equal(await page.locator('.available-model-option').count(), 1)
    await page.locator('.available-model-option').click()
    assert.equal(await page.getByLabel('Modell-ID', { exact: true }).inputValue(), 'koda-fast')
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()
    await page.getByText('Einstellungen gespeichert.', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Einstellungen schließen' }).click()
    await page.locator('.sidebar-settings').click()
    await page.getByRole('tab', { name: 'Eigener', exact: true }).click()
    await page.locator('.available-model-option.selected').waitFor()
    assert.equal(await page.locator('.available-model-option').count(), 12)
    assert.equal(await page.locator('.available-model-option.selected').innerText(), 'koda-fast')
    await page.locator('.available-model-option').filter({ hasText: /^koda-test$/ }).click()
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()
    await page.getByText('Einstellungen gespeichert.', { exact: true }).waitFor()
    await page.locator('#api-key').fill('koda-second-test-account')
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()
    await until(() => page.locator('.available-models').count().then(count => count === 0), 'Changing the API key did not clear cached models')
    modelResponse = []
    await page.getByRole('button', { name: 'Verbindung prüfen', exact: true }).click()
    await page.getByText('Verbindung steht. 0 Modelle verfügbar.').waitFor()
    assert.equal(await page.locator('.available-model-option').count(), 0)
    await page.getByText('Der Anbieter hat keine Modelle zurückgegeben.', { exact: false }).waitFor()
    modelResponse = availableModels
    await page.getByRole('button', { name: 'Verbindung prüfen', exact: true }).click()
    await page.getByText('Verbindung steht. 12 Modelle verfügbar.').waitFor()
    assert.equal(await page.locator('.available-model-option').count(), 12)
    console.log('PASS visible model discovery, search, selection, persistence and empty model list')
    await page.getByRole('button', { name: 'Erscheinungsbild', exact: true }).click()
    await page.getByRole('button', { name: 'Dunkel', exact: true }).click()
    await until(() => page.evaluate(() => document.documentElement.dataset.theme === 'dark'), 'Dark theme was not applied')
    await page.getByRole('button', { name: 'Einstellungen schließen' }).click()
    await page.screenshot({ animations: 'disabled', path: 'artifacts/home-dark.png' })
    await page.locator('.sidebar-settings').click()
    await page.getByRole('button', { name: 'Erscheinungsbild', exact: true }).click()
    await page.getByRole('button', { name: 'Hell', exact: true }).click()
    await page.getByRole('button', { name: 'Einstellungen schließen' }).click()
    console.log('PASS custom endpoint, model discovery and theme persistence')

    await app.evaluate(({ dialog }, project) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] }) }, projectPath)
    await page.locator('.open-project-tile').click()
    await page.getByText('hello.txt', { exact: true }).waitFor()
    await page.locator('.tree-entry').filter({ hasText: 'context.ts' }).click()
    await page.getByRole('button', { name: 'Als Kontext hinzufügen', exact: true }).click()
    assert.equal(await page.locator('.attachment-chip').count(), 1)
    await page.locator('.attachment-chip button').click()
    await page.getByRole('button', { name: 'Dateiansicht schließen' }).click()
    console.log('PASS native folder registration, file tree, preview and context attachment')

    await page.getByRole('textbox', { name: 'Nachricht an Koda' }).fill('__workflow__')
    await page.getByRole('button', { name: 'Nachricht senden' }).click()
    await page.getByRole('button', { name: 'Änderung übernehmen', exact: true }).waitFor()
    assert.equal(await fs.readFile(path.join(projectPath, 'hello.txt'), 'utf8'), 'Original\n')
    await page.screenshot({ animations: 'disabled', path: 'artifacts/change-approval.png' })
    await page.getByRole('button', { name: 'Änderung übernehmen', exact: true }).click()
    await page.getByRole('button', { name: 'Ausführen', exact: true }).click()
    await page.getByText('Die Datei wurde aktualisiert und der Befehl erfolgreich ausgeführt.', { exact: false }).waitFor()
    await until(() => page.locator('.run-status').count().then(count => count === 0), 'Agent did not finish')
    assert.equal(await fs.readFile(path.join(projectPath, 'hello.txt'), 'utf8'), 'Hallo von Koda.\n')
    assert.equal(await page.locator('.tool-card').count(), 4)
    assert.equal(await page.locator('.code-block').count(), 1)
    assert.match(await page.locator('.tool-output').allTextContents().then(parts => parts.join(' ')), /koda-terminal-ok/)
    await page.screenshot({ animations: 'disabled', path: 'artifacts/chat.png' })
    console.log('PASS streamed multi-step agent, read tools, approved file diff and shell execution')

    await page.getByRole('textbox', { name: 'Nachricht an Koda' }).fill('__deny__')
    await page.getByRole('button', { name: 'Nachricht senden' }).click()
    await page.getByRole('button', { name: 'Ablehnen', exact: true }).click()
    await page.getByText('Die Änderung wurde abgelehnt. Deine Datei bleibt erhalten.', { exact: false }).waitFor()
    await until(() => page.locator('.run-status').count().then(count => count === 0), 'Denied run did not finish')
    assert.equal(await fs.readFile(path.join(projectPath, 'hello.txt'), 'utf8'), 'Hallo von Koda.\n')
    console.log('PASS denied changes leave project untouched')

    await page.locator('.mode-button').click()
    await page.locator('.mode-menu > button').filter({ hasText: 'Fragen' }).click()
    await page.getByRole('textbox', { name: 'Nachricht an Koda' }).fill('__ask__')
    await page.getByRole('button', { name: 'Nachricht senden' }).click()
    await page.getByText('Im Fragen-Modus lese ich dein Projekt, ohne Änderungen vorzunehmen.', { exact: false }).waitFor()
    await until(() => page.locator('.run-status').count().then(count => count === 0), 'Ask run did not finish')
    assert.deepEqual(requests.at(-1).tools.map(tool => tool.function.name).sort(), ['list_files', 'read_file'])
    console.log('PASS ask mode exposes only read tools')

    await page.getByRole('textbox', { name: 'Nachricht an Koda' }).fill('__slow__')
    await page.getByRole('button', { name: 'Nachricht senden' }).click()
    await page.getByText('Koda denkt nach …', { exact: true }).waitFor()
    assert.equal(await page.locator('.messages .run-status').count(), 1)
    assert.equal(await page.locator('.messages .spin').count(), 1)
    assert.equal(await page.locator('.thinking').count(), 0)
    await page.locator('.messages .run-status').scrollIntoViewIfNeeded()
    await page.screenshot({ animations: 'disabled', path: 'artifacts/single-loading.png' })
    await page.getByText('Eine lange Antwort', { exact: false }).waitFor()
    assert.equal(await page.locator('.messages .run-status').count(), 1)
    assert.equal(await page.locator('.messages .spin').count(), 1)
    assert.equal(await page.locator('.messages .run-status').innerText(), 'Koda arbeitet …')
    await page.getByRole('button', { name: 'Antwort stoppen' }).click()
    await page.getByText('Antwort gestoppt', { exact: true }).waitFor()
    assert.equal(await page.locator('.messages .run-status').count(), 0)
    console.log('PASS one loading indicator before and during streaming, removed on cancellation')

    await page.getByRole('textbox', { name: 'Nachricht an Koda' }).fill('__error__')
    await page.getByRole('button', { name: 'Nachricht senden' }).click()
    await page.getByText('Der API-Key wurde nicht akzeptiert. Bitte prüfe deine Einstellungen.').waitFor()
    console.log('PASS provider errors recover without crashing')

    await until(async () => { const data = JSON.parse(await fs.readFile(path.join(dataPath, 'workspace.json'), 'utf8')); return data.conversations[0].messages.at(-1).error }, 'History was not persisted')
    await page.reload()
    await page.getByRole('heading', { name: 'Was bauen wir heute?' }).waitFor()
    await page.getByRole('button', { name: /^Verlauf/ }).click()
    assert.equal(await page.locator('.history-item').count(), 1)
    await page.getByRole('textbox', { name: 'Chats durchsuchen' }).fill('kein-treffer')
    await page.getByRole('heading', { name: 'Kein Chat gefunden.' }).waitFor()
    await page.getByRole('button', { name: 'Suche leeren' }).click()
    await page.locator('.history-item > button:first-child').click()
    assert.equal(await page.locator('.message.user').count(), 5)
    console.log('PASS persisted history, search and reload')

    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1000, 720) })
    await page.screenshot({ animations: 'disabled', path: 'artifacts/compact.png' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.locator('.sidebar-settings').click()
    await page.screenshot({ animations: 'disabled', path: 'artifacts/settings-compact.png' })
    assert.equal(await page.getByRole('button', { name: 'Einstellungen schließen' }).isVisible(), true)
    assert.deepEqual(errors, [])
    console.log(`PASS compact desktop layout and zero renderer errors\nE2E COMPLETE: ${requests.length} mock requests; no paid API requests; data ${directory}`)
  } catch (error) {
    if (page) { console.error('CURRENT UI:', (await page.locator('body').innerText().catch(() => '')).slice(-5000)); await page.screenshot({ animations: 'disabled', path: 'artifacts/e2e-failure.png' }).catch(() => {}) }
    throw error
  } finally {
    if (app) await app.close()
    server.closeAllConnections(); server.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
