const { _electron: electron } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')

async function until(check, message) {
  const started = Date.now()
  while (Date.now() - started < 10000) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 60)) }
  throw new Error(message)
}
const key = 'unorouter-local-test-key'
const models = ['gpt-6.1-sol', 'claude-haiku-5-5', 'minimax-m3.1-flash:free', 'qwen3.8-27b:free', 'claude-fable-5', 'route-changing-model']
const requests = []
const server = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${key}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Invalid API key' } })); return
  }
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ object: 'list', data: models.map(id => ({ id, object: 'model', ...(id === 'route-changing-model' ? { metadata: { reasoningEfforts: ['low', 'medium', 'high'], maxOutputTokens: 32768 } } : {}) })) })); return
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return }
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw); requests.push(body)
  if (body.model === 'route-changing-model' && body.reasoning_effort === 'high') {
    res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Unexpected reasoning effort high. Supported types are xhigh (default), and low.' } })); return
  }
  if (body.model === 'qwen3.8-27b:free' && !['low', 'medium', 'xhigh'].includes(body.reasoning_effort)) {
    res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Unexpected reasoning effort high. Supported types are xhigh (default), medium, and low.' } })); return
  }
  const lastUser = body.messages.findLastIndex(message => message.role === 'user')
  const user = String(body.messages[lastUser].content)
  const results = body.messages.slice(lastUser + 1).filter(message => message.role === 'tool')
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const delta = (value, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'uno-test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: value, finish_reason }] })}\n\n`)
  const finish = reason => { delta({}, reason); res.end('data: [DONE]\n\n') }
  const call = (name, args) => {
    const json = JSON.stringify(args), split = Math.floor(json.length / 2)
    delta({ role: 'assistant', tool_calls: [{ index: 0, id: `uno-tool-${requests.length}`, type: 'function', function: { name, arguments: json.slice(0, split) } }] })
    delta({ tool_calls: [{ index: 0, function: { arguments: json.slice(split) } }] }); finish('tool_calls')
  }
  if (user === '__tools__' && !results.length) return call('read_file', { path: 'hello.txt' })
  if (user === '__tools__' && results.length === 1) return call('write_file', { path: 'hello.txt', content: 'Mit UnoRouter geändert.\n' })
  if (user === '__tools__') { delta({ role: 'assistant', content: 'Datei über UnoRouter aktualisiert.' }); finish('stop'); return }
  delta({ role: 'assistant', content: 'UnoRouter streamt ' })
  const timer = setTimeout(() => { delta({ content: 'die Antwort erfolgreich.' }); finish('stop') }, 650)
  res.on('close', () => clearTimeout(timer))
})

;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'koda-unorouter-e2e-'))
  const directory = path.join(root, 'data'), project = path.join(root, 'project')
  await fs.mkdir(directory); await fs.mkdir(project)
  await fs.writeFile(path.join(project, 'hello.txt'), 'Vorhandene Datei.\n')
  // A 0.2.5 profile has only five providers. Loading it must add UnoRouter
  // without replacing an existing custom endpoint or native effort setting.
  await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({
    providers: [
      { id: 'openai', model: 'gpt-6.1-sol', baseURL: 'https://api.openai.com/v1', models: [] },
      { id: 'anthropic', model: 'claude-sonnet-5-5', baseURL: 'https://api.anthropic.com/v1', models: [] },
      { id: 'google', model: 'gemini-3.8-flash', baseURL: 'https://generativelanguage.googleapis.com/v1beta', models: [] },
      { id: 'xai', model: 'grok-4.7', baseURL: 'https://api.x.ai/v1', models: [] },
      { id: 'custom', model: 'existing-local-model', baseURL: 'http://localhost:11434/v1', models: [] },
    ], defaultProvider: 'custom', theme: 'dark', fontSize: 14, systemPrompt: '', secrets: {}, effortPreferences: { 'openai:gpt-6.1-sol': 'max' },
  }))
  const env = { ...process.env, KODA_USER_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE
  let app, page
  const errors = []
  const launch = async () => {
    app = await electron.launch({ executablePath: process.env.KODA_TEST_EXE ? path.resolve(process.env.KODA_TEST_EXE) : require('electron'), args: process.env.KODA_TEST_EXE ? [] : [path.resolve('.')], env })
    page = await app.firstWindow(); page.setDefaultTimeout(15000)
    page.on('pageerror', error => errors.push(error.message))
    await page.locator('.welcome h1').waitFor()
    // Redirect only this isolated test process's UnoRouter HTTP requests to a
    // local fixture. Production URLs and validation remain unchanged.
    await app.evaluate(({ dialog, shell }, origin) => {
      const original = global.fetch
      global.__unoUrls = []
      global.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.startsWith('https://api.unorouter.com/v1/')) { global.__unoUrls.push(url); return original(origin + new URL(url).pathname, init) }
        return original(input, init)
      }
      dialog.showMessageBox = async () => ({ response: 0 })
      shell.openExternal = async url => { global.__unoExternal = url }
    }, `http://127.0.0.1:${server.address().port}`)
  }
  try {
    await launch()
    const initial = await page.evaluate(() => window.koda.getSettings())
    assert.equal(initial.providers.length, 6)
    assert.equal(initial.providers.find(provider => provider.id === 'custom').model, 'existing-local-model')
    assert.equal(initial.effortPreferences['openai:gpt-6.1-sol'], 'max')
    await page.locator('.sidebar-settings').click()
    assert.deepEqual(await page.getByRole('tab').evaluateAll(tabs => tabs.slice(-2).map(tab => tab.querySelector(':scope > span:not([aria-hidden])').textContent)), ['Eigener', 'UnoRouter'])
    await page.getByRole('tab', { name: 'UnoRouter', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Verbindung prüfen', exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: 'API-Key erstellen' }).click()
    assert.equal(await app.evaluate(() => global.__unoExternal), 'https://unorouter.com/en/token')
    await page.locator('#api-key').fill('invalid-test-key')
    await page.getByRole('button', { name: 'Verbindung prüfen', exact: true }).click()
    await page.getByText('Der API-Key wurde nicht akzeptiert. Prüfe Key und Berechtigungen.', { exact: true }).waitFor()
    await page.locator('#api-key').fill(key)
    await page.getByRole('button', { name: 'Verbindung prüfen', exact: true }).click()
    await page.getByText('Verbindung steht. 6 Modelle verfügbar.', { exact: true }).waitFor()
    await page.locator('.available-model-option').filter({ hasText: 'GPT-6.1 Sol' }).click()
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()
    await page.getByText('Einstellungen gespeichert.', { exact: true }).waitFor()
    const stored = await fs.readFile(path.join(directory, 'settings.json'), 'utf8')
    assert.equal(stored.includes(key), false)
    const publicSettings = await page.evaluate(() => window.koda.getSettings())
    assert.equal(JSON.stringify(publicSettings).includes(key), false)
    assert.equal(publicSettings.providers.find(provider => provider.id === 'unorouter').hasKey, true)
    assert.equal(publicSettings.providers.find(provider => provider.id === 'custom').baseURL, 'http://localhost:11434/v1')
    await page.evaluate(async () => {
      try { await window.koda.saveProvider('unorouter', { model: 'test', baseURL: 'https://example.com/v1' }); throw new Error('foreign host accepted') }
      catch (error) { if (!String(error).includes('Eigener Anbieter')) throw error }
    })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 720))
    await page.locator('.settings-content').evaluate(element => { element.scrollTop = 0 })
    const tab = await page.getByRole('tab', { name: 'UnoRouter', exact: true }).boundingBox()
    assert.ok(tab.x >= 0 && tab.x + tab.width <= 1000)
    await fs.mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/unorouter-settings.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Einstellungen schließen' }).click()
    console.log('PASS 0.2.5 profile migration, UnoRouter entry after Eigener, model discovery, rejected keys, independent encrypted credentials and fixed host')

    await page.locator('.model-button').click()
    await page.locator('.model-group').filter({ hasText: 'UnoRouter' }).getByRole('button', { name: 'GPT-6.1 Sol', exact: true }).click()
    assert.equal(await page.locator('.effort-button').count(), 1)
    const send = async value => { await page.getByRole('textbox', { name: 'Nachricht an Koda' }).fill(value); await page.getByRole('button', { name: 'Nachricht senden' }).click() }
    const idle = () => until(() => page.getByRole('button', { name: 'Antwort stoppen' }).count().then(count => count === 0), 'UnoRouter chat did not finish')
    await send('Route testen')
    await page.getByText('UnoRouter streamt', { exact: false }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Antwort stoppen' }).count(), 1)
    await page.getByText('UnoRouter streamt die Antwort erfolgreich.', { exact: true }).waitFor(); await idle()
    assert.equal(requests[0].model, 'gpt-6.1-sol'); assert.equal(requests[0].stream, true)
    assert.equal(requests[0].tools, undefined); assert.equal(requests[0].reasoning_effort, 'max')
    console.log('PASS real Chat Completions streaming through UnoRouter adapter with exact model IDs and route-specific reasoning parameters')

    await page.locator('.new-chat-button').click()
    await page.getByRole('button', { name: 'Code-Modus', exact: true }).click()
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, project)
    await page.locator('.open-project-tile').click(); await page.getByRole('button', { name: 'Dateiansicht schließen' }).click()
    await send('__tools__')
    await page.getByRole('button', { name: 'Änderung übernehmen', exact: true }).waitFor()
    assert.equal(await fs.readFile(path.join(project, 'hello.txt'), 'utf8'), 'Vorhandene Datei.\n')
    await page.getByRole('button', { name: 'Änderung übernehmen', exact: true }).click()
    await page.getByText('Datei über UnoRouter aktualisiert.', { exact: true }).waitFor(); await idle()
    assert.equal(await fs.readFile(path.join(project, 'hello.txt'), 'utf8'), 'Mit UnoRouter geändert.\n')
    assert.equal(await page.locator('.tool-card.done').count(), 2)
    assert.ok(requests.at(-1).messages.some(message => message.role === 'tool'))
    const urls = await app.evaluate(() => global.__unoUrls)
    assert.ok(urls.includes('https://api.unorouter.com/v1/models'))
    assert.equal(urls.filter(url => url.endsWith('/chat/completions')).length, 4)
    console.log('PASS fragmented streamed tool calls, read file, approved write and tool-result continuation in Code mode')

    const chooseModel = async name => { await page.locator('.model-button').click(); await page.locator('.model-group').filter({ hasText: 'UnoRouter' }).getByRole('button', { name, exact: true }).click() }
    const chooseEffort = async name => { await page.locator('.effort-button').click(); await page.getByRole('menuitemradio', { name: name === 'Auto' ? /^Auto/ : name, exact: true }).click() }
    await page.locator('.new-chat-button').click()
    await chooseModel('qwen3.8-27b:free')
    await page.locator('.effort-button').click()
    assert.equal(await page.locator('.effort-options > button').count(), 4)
    assert.equal(await page.getByRole('menuitemradio', { name: 'Hoch', exact: true }).count(), 0)
    await page.getByRole('menuitemradio', { name: 'Mittel', exact: true }).click()
    await send('Qwen Effort prüfen'); await idle()
    assert.equal(requests.at(-1).reasoning_effort, 'medium')
    await chooseEffort('Auto')
    await send('Qwen Auto prüfen'); await idle()
    assert.equal(requests.at(-1).reasoning_effort, 'xhigh')
    assert.ok(requests.at(-1).max_tokens <= 32768)
    await page.locator('.effort-button').click(); await page.screenshot({ path: 'artifacts/unorouter-qwen-effort.png', animations: 'disabled' }); await page.keyboard.press('Escape')
    await chooseModel('claude-fable-5'); await chooseEffort('Maximum')
    await send('Fable Effort prüfen'); await idle()
    assert.equal(requests.at(-1).reasoning_effort, 'max')
    await chooseModel('route-changing-model'); await chooseEffort('Hoch')
    const beforeError = requests.length
    await send('Routenwechsel prüfen'); await idle()
    await page.getByText(/Das Effort-Menü wurde aktualisiert/).waitFor()
    assert.equal(requests.length, beforeError + 1)
    await page.locator('.effort-button').click()
    assert.equal(await page.getByRole('menuitemradio', { name: 'Hoch', exact: true }).count(), 0)
    await page.getByRole('menuitemradio', { name: 'Sehr hoch', exact: true }).click()
    await send('Korrigierte Route prüfen'); await idle()
    assert.equal(requests.at(-1).reasoning_effort, 'xhigh')
    console.log('PASS Qwen and Fable effort UI, valid Auto, output ceiling, learned route levels, retry by user only and correct API parameters')

    await until(async () => {
      const saved = JSON.parse(await fs.readFile(path.join(directory, 'workspace.json'), 'utf8'))
      return saved.conversations.some(chat => chat.messages.some(message => message.content === 'Datei über UnoRouter aktualisiert.')) && saved.conversations.some(chat => chat.messages.some(message => message.content === 'UnoRouter streamt die Antwort erfolgreich.'))
    }, 'Chat autosave did not persist completed UnoRouter replies')
    await app.close(); app = null; await launch()
    const restored = await page.evaluate(() => window.koda.getSettings())
    const uno = restored.providers.find(provider => provider.id === 'unorouter')
    assert.equal(uno.model, 'gpt-6.1-sol'); assert.equal(uno.hasKey, true); assert.equal(uno.models.length, 6)
    await page.locator('.recent-chat').filter({ hasText: 'Route testen' }).click()
    await page.getByText('UnoRouter streamt die Antwort erfolgreich.', { exact: true }).waitFor()
    await send('Nach Neustart'); await idle()
    assert.deepEqual(uno.modelCapabilities['route-changing-model'].effortLevels, ['low', 'xhigh'])
    await page.evaluate(async apiKey => { await window.koda.saveProvider('custom', { model: 'qwen3.8-27b:free', baseURL: 'https://api.unorouter.com/v1', apiKey }) }, key)
    await page.reload(); await page.locator('.welcome h1').waitFor()
    await chooseEffort('Mittel'); await send('UnoRouter unter Eigener prüfen'); await idle()
    assert.equal(requests.at(-1).reasoning_effort, 'medium')
    console.log('PASS UnoRouter effort through Eigener Anbieter and learned capabilities after native restart')
    await page.locator('.sidebar-settings').click(); await page.getByRole('tab', { name: 'UnoRouter', exact: true }).click()
    await page.getByRole('button', { name: 'API-Key entfernen', exact: true }).click()
    await page.getByRole('button', { name: 'Entfernen', exact: true }).click()
    await until(async () => !(await page.evaluate(() => window.koda.getSettings())).providers.find(provider => provider.id === 'unorouter').hasKey, 'UnoRouter key not removed')
    assert.equal(await page.getByRole('button', { name: 'Verbindung prüfen', exact: true }).isDisabled(), true)
    assert.deepEqual(errors, [])
    console.log('PASS settings, key decryption, model list and chat persistence after native restart; isolated key removal; zero renderer errors')
    console.log(`UNOROUTER E2E COMPLETE: ${requests.length} local mock requests; no paid API requests; isolated data ${root}`)
  } catch (error) {
    if (page) { console.error('CURRENT UI:', (await page.locator('body').innerText().catch(() => '')).slice(-4500)); await page.screenshot({ path: 'artifacts/unorouter-failure.png' }).catch(() => {}) }
    throw error
  } finally { if (app) await app.close(); server.closeAllConnections(); server.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
