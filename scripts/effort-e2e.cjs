const { _electron: electron } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

async function until(check, message) {
  const started = Date.now()
  while (Date.now() - started < 10000) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 60)) }
  throw new Error(message)
}
;(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'koda-effort-e2e-'))
  const data = path.join(directory, 'data'); await fs.mkdir(data)
  await fs.writeFile(path.join(data, 'workspace.json'), JSON.stringify({ projects: [], conversations: [{ id: 'old', title: 'Unterbrochener Build', provider: 'openai', model: 'gpt-6.1-sol', mode: 'code', updatedAt: Date.now() - 3600_000, messages: [{ id: 'old-message', role: 'assistant', content: '', createdAt: Date.now() - 3600_000, tools: [{ id: 'old-tool', name: 'build_project', status: 'running', startedAt: Date.now() - 3600_000, input: { javaVersion: 21, command: 'gradle build' } }] }] }] }))
  const env = { ...process.env, KODA_USER_DATA: data }; delete env.ELECTRON_RUN_AS_NODE
  let app, page
  const errors = []
  try {
    app = await electron.launch({ executablePath: process.env.KODA_TEST_EXE ? path.resolve(process.env.KODA_TEST_EXE) : require('electron'), args: process.env.KODA_TEST_EXE ? [] : [path.resolve('.')], env })
    page = await app.firstWindow(); page.setDefaultTimeout(15000)
    page.on('pageerror', error => errors.push(error.message))
    await page.locator('.welcome h1').waitFor()
    await page.evaluate(async () => {
      const settings = await window.koda.getSettings()
      for (const id of ['openai', 'anthropic', 'google', 'xai']) {
        const config = settings.providers.find(provider => provider.id === id)
        await window.koda.saveProvider(id, { model: config.model, baseURL: config.baseURL, apiKey: 'dummy-effort-key' })
      }
    })
    await page.reload(); await page.locator('.welcome h1').waitFor()
    // Capture the UI/IPC request without contacting an actual model. SDK wire
    // formats are verified separately by provider contract tests on localhost.
    await app.evaluate(({ ipcMain }) => {
      global.__effortRequests = []
      ipcMain.removeHandler('chat:start')
      ipcMain.handle('chat:start', (event, request) => {
        global.__effortRequests.push(request)
        event.sender.send('chat:event', { type: 'text', requestId: request.requestId, text: 'Die Effort-Auswahl wurde übernommen.' })
        setTimeout(() => event.sender.send('chat:event', { type: 'done', requestId: request.requestId, apiMessages: [], tokens: 1 }), 600)
      })
    })
    await page.locator('.recent-chat').filter({ hasText: 'Unterbrochener Build' }).click()
    assert.equal(await page.locator('.tool-card.cancelled').count(), 1)
    assert.equal(await page.locator('.tool-running-progress').count(), 0)
    assert.equal(await page.locator('.tool-time').count(), 0)
    assert.equal(await page.locator('.run-status').count(), 0)
    await page.locator('.new-chat-button').click()
    console.log('PASS old interrupted builds restore as stopped and do not restart hour-old counters')

    const chooseModel = async name => {
      await page.locator('.model-button').click()
      await page.locator('.model-group').filter({ hasText: name }).locator('button').first().click()
    }
    const chooseEffort = async name => {
      await page.locator('.effort-button').click()
      await page.getByRole('menuitemradio', { name, exact: true }).click()
    }
    await page.locator('.effort-button').click()
    assert.equal(await page.getByRole('menuitemradio', { name: 'Ohne', exact: true }).count(), 0)
    assert.equal(await page.getByRole('menuitemradio', { name: 'Minimal', exact: true }).count(), 0)
    await page.getByRole('menuitemradio', { name: 'Maximum', exact: true }).click()
    await page.getByRole('button', { name: 'Effort: Maximum', exact: true }).waitFor()
    await chooseModel('Claude'); await chooseEffort('Sehr hoch')
    await chooseModel('Gemini')
    await page.locator('.effort-button').click()
    assert.equal(await page.locator('.effort-options > button').count(), 4)
    for (const name of ['Maximum', 'Sehr hoch', 'Minimal', 'Ohne']) assert.equal(await page.getByRole('menuitemradio', { name, exact: true }).count(), 0)
    await page.getByRole('menuitemradio', { name: 'Hoch', exact: true }).click()
    await page.getByRole('textbox', { name: 'Nachricht an Koda' }).fill('Effort prüfen')
    await page.getByRole('button', { name: 'Nachricht senden' }).click()
    assert.equal(await page.locator('.effort-button').isDisabled(), true)
    await until(() => page.getByRole('button', { name: 'Antwort stoppen' }).count().then(count => count === 0), 'Effort chat did not finish')
    const request = await app.evaluate(() => global.__effortRequests.at(-1))
    assert.equal(request.provider, 'google'); assert.equal(request.model, 'gemini-3.8-flash'); assert.equal(request.effort, 'high')
    await chooseModel('Grok'); await chooseEffort('Mittel')
    await chooseModel('OpenAI')
    await page.getByRole('button', { name: 'Effort: Maximum', exact: true }).waitFor()
    const preferences = await page.evaluate(async () => (await window.koda.getSettings()).effortPreferences)
    assert.equal(preferences['openai:gpt-6.1-sol'], 'max')
    assert.equal(preferences['anthropic:claude-sonnet-5-5'], 'xhigh')
    assert.equal(preferences['google:gemini-3.8-flash'], 'high')
    assert.equal(preferences['xai:grok-4.7'], 'medium')
    await page.reload(); await page.locator('.welcome h1').waitFor()
    await page.getByRole('button', { name: 'Effort: Maximum', exact: true }).waitFor()
    await page.locator('.recent-chat').filter({ hasText: 'Effort prüfen' }).click()
    await page.getByRole('button', { name: 'Effort: Hoch', exact: true }).waitFor()
    console.log('PASS per-model effort choices, restricted Gemini levels, request forwarding and persistence across model switches/restart')

    await page.locator('.new-chat-button').click(); await chooseModel('OpenAI')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 720))
    await page.locator('.effort-button').click()
    assert.equal(await page.locator('.effort-menu').evaluate(element => { const rect = element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth }), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await fs.mkdir('artifacts', { recursive: true })
    await page.screenshot({ path: 'artifacts/effort-menu.png', animations: 'disabled' })
    await page.keyboard.press('Escape')
    await page.evaluate(async () => {
      const config = (await window.koda.getSettings()).providers.find(provider => provider.id === 'openai')
      await window.koda.saveProvider('openai', { model: 'gpt-4.1', baseURL: config.baseURL })
      await window.koda.saveProvider('custom', { model: 'gpt-6.1-sol', baseURL: 'http://localhost:11434/v1' })
    })
    await page.reload(); await page.locator('.welcome h1').waitFor()
    assert.equal(await page.locator('.effort-button').count(), 0)
    await page.getByRole('textbox', { name: 'Nachricht an Koda' }).fill('Ohne Effort-Unterstützung')
    await page.getByRole('button', { name: 'Nachricht senden' }).click()
    await until(() => page.getByRole('button', { name: 'Antwort stoppen' }).count().then(count => count === 0), 'Default chat did not finish')
    assert.equal(await app.evaluate(() => global.__effortRequests.at(-1).effort), 'auto')
    await chooseModel('Eigener Anbieter')
    assert.equal(await page.locator('.effort-button').count(), 0)
    assert.deepEqual(errors, [])
    console.log('PASS compact effort menu and no unsupported controls/parameters for GPT-4.1 or arbitrary compatible endpoints')
    console.log(`EFFORT E2E COMPLETE: no paid API requests; isolated data ${directory}`)
  } catch (error) {
    if (page) { console.error('CURRENT UI:', (await page.locator('body').innerText().catch(() => '')).slice(-4500)); await page.screenshot({ path: 'artifacts/effort-failure.png' }).catch(() => {}) }
    throw error
  } finally { if (app) await app.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
