const { _electron: electron } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')

async function until(check, message, timeout = 10000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    try { if (await check()) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 60))
  }
  throw new Error(message)
}
const requests = []
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw); requests.push(body)
  const last = body.messages.findLastIndex(message => message.role === 'user')
  const user = String(body.messages[last].content)
  const tools = body.messages.slice(last + 1).filter(message => message.role === 'tool')
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const delta = (value, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'agent-test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: value, finish_reason }] })}\n\n`)
  const text = content => { delta({ role: 'assistant', content }); delta({}, 'stop'); res.end('data: [DONE]\n\n') }
  const call = (name, args) => { delta({ role: 'assistant', tool_calls: [{ index: 0, id: `tool-${requests.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }); delta({}, 'tool_calls'); res.end('data: [DONE]\n\n') }
  if (user === '__full_access__') {
    if (!tools.length) return call('write_file', { path: 'full-access.txt', content: 'Automatisch geschrieben.\n' })
    if (tools.length === 1) return call('run_command', { command: "Write-Output 'live-before'; Start-Sleep -Seconds 3; Write-Output 'live-after'", explanation: 'Prüft die Live-Ausgabe eines laufenden Befehls.' })
    return text('Vollzugriff abgeschlossen.')
  }
  if (user === '__cancel_command__') {
    if (!tools.length) return call('run_command', { command: `node -e "console.log('cancel-ready'); setTimeout(() => require('fs').writeFileSync('must-not-exist.txt', 'unexpected'), 3000)"`, explanation: 'Prüft das Stoppen eines Befehls mit Kindprozess.' })
    return text('Befehl beendet.')
  }
  text('Nur lesend geprüft.')
})

;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'koda-agent-e2e-'))
  const project = path.join(directory, 'projekt'), data = path.join(directory, 'data')
  await fs.mkdir(project); await fs.writeFile(path.join(project, 'context.txt'), 'Testkontext')
  const env = { ...process.env, KODA_USER_DATA: data }; delete env.ELECTRON_RUN_AS_NODE
  let app, page
  const errors = []
  try {
    app = await electron.launch({ executablePath: process.env.KODA_TEST_EXE ? path.resolve(process.env.KODA_TEST_EXE) : require('electron'), args: process.env.KODA_TEST_EXE ? [] : [path.resolve('.')], env })
    page = await app.firstWindow(); page.setDefaultTimeout(15000)
    page.on('pageerror', error => errors.push(error.message))
    await page.locator('.welcome h1').waitFor()
    await page.evaluate(async url => {
      await window.koda.saveProvider('custom', { model: 'test', baseURL: url })
      await window.koda.saveSettings({ defaultProvider: 'custom', theme: 'dark' })
    }, `http://127.0.0.1:${server.address().port}/v1`)
    await page.reload(); await page.locator('.welcome h1').waitFor()
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, project)
    await page.locator('.open-project-tile').click()
    await page.getByText('context.txt', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Dateiansicht schließen' }).click()
    await page.getByRole('button', { name: 'Berechtigungen: Nachfragen', exact: true }).click()
    await page.getByRole('menuitemradio', { name: /^Vollzugriff/ }).click()
    await page.getByRole('textbox', { name: 'Nachricht an Koda' }).fill('__full_access__')
    await page.getByRole('button', { name: 'Nachricht senden' }).click()
    const live = page.locator('.command-card.running .terminal-output')
    await until(() => live.innerText().then(value => value.includes('live-before') && !value.includes('live-after')), 'No live output before command completion')
    assert.equal(await page.locator('.approval-actions').count(), 0)
    assert.equal(await page.locator('.messages .run-status').count(), 0)
    assert.equal(await page.locator('.tool-running-progress').isVisible(), true)
    assert.equal(await page.locator('.tool-running-progress > span').evaluate(element => getComputedStyle(element).animationName), 'command-progress')
    assert.equal(await page.getByRole('button', { name: 'Berechtigungen: Vollzugriff', exact: true }).isDisabled(), true)
    await fs.mkdir('artifacts', { recursive: true })
    await page.screenshot({ path: 'artifacts/terminal-live.png', animations: 'disabled' })

    await page.getByRole('textbox', { name: 'Nachricht an Koda' }).fill('Dieser Entwurf bleibt erhalten.')
    await page.evaluate(() => { window.__reloadSentinel = 'still-here' })
    for (const shortcut of ['Control+r', 'Control+Shift+r', 'F5', 'Control+F5']) await page.keyboard.press(shortcut)
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      for (const [keyCode, modifiers] of [['R', ['control']], ['R', ['control', 'shift']], ['F5', []]]) {
        contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
        contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
      }
    })
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal(await page.evaluate(() => window.__reloadSentinel), 'still-here')
    assert.equal(await page.getByRole('textbox', { name: 'Nachricht an Koda' }).inputValue(), 'Dieser Entwurf bleibt erhalten.')
    await page.getByText('Vollzugriff abgeschlossen.', { exact: true }).waitFor()
    await until(() => page.getByRole('button', { name: 'Antwort stoppen' }).count().then(count => count === 0), 'Full-access run did not finish')
    assert.equal(await fs.readFile(path.join(project, 'full-access.txt'), 'utf8'), 'Automatisch geschrieben.\n')
    assert.match(await page.locator('.terminal-output').innerText(), /live-after/)
    assert.equal(await page.locator('.tool-running-progress').count(), 0)
    await until(async () => JSON.parse(await fs.readFile(path.join(data, 'workspace.json'), 'utf8')).conversations[0].permissions === 'full-access', 'Chat permissions were not persisted')
    console.log('PASS full access, live output, animation, duration, saved permissions and blocked reload shortcuts during execution')

    await page.getByRole('button', { name: 'Berechtigungen: Vollzugriff', exact: true }).click()
    await page.getByRole('menuitemradio', { name: /^Nur lesen/ }).click()
    await page.getByRole('textbox', { name: 'Nachricht an Koda' }).fill('__read_only__')
    await page.getByRole('button', { name: 'Nachricht senden' }).click()
    await page.getByText('Nur lesend geprüft.', { exact: true }).waitFor()
    await until(() => page.getByRole('button', { name: 'Antwort stoppen' }).count().then(count => count === 0), 'Read-only run did not finish')
    assert.deepEqual(requests.at(-1).tools.map(tool => tool.function.name).sort(), ['inspect_build', 'list_files', 'read_file'])
    console.log('PASS read-only permissions remove write and shell tools in Code mode')

    await page.locator('.project-item').click()
    await page.getByRole('button', { name: 'Dateiansicht schließen' }).click()
    await page.getByRole('button', { name: 'Berechtigungen: Nachfragen', exact: true }).click()
    await page.getByRole('menuitemradio', { name: /^Vollzugriff/ }).click()
    await page.getByRole('textbox', { name: 'Nachricht an Koda' }).fill('__cancel_command__')
    await page.getByRole('button', { name: 'Nachricht senden' }).click()
    await until(() => page.locator('.command-card.running .terminal-output').innerText().then(value => value.includes('cancel-ready')), 'Child command did not start')
    await page.getByRole('button', { name: 'Antwort stoppen' }).click()
    await page.locator('.command-card.cancelled').waitFor()
    await until(() => page.getByRole('button', { name: 'Antwort stoppen' }).count().then(count => count === 0), 'Cancelled run remained busy')
    await new Promise(resolve => setTimeout(resolve, 3500))
    await assert.rejects(fs.stat(path.join(project, 'must-not-exist.txt')), { code: 'ENOENT' })
    assert.equal(await page.locator('.tool-running-progress').count(), 0)
    console.log('PASS Stop terminates shell and child processes and removes the running animation')

    await page.locator('.new-chat-button').click()
    await page.getByRole('button', { name: 'Berechtigungen: Nachfragen', exact: true }).waitFor()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 720))
    await page.getByRole('button', { name: 'Berechtigungen: Nachfragen', exact: true }).click()
    assert.equal(await page.locator('.permission-menu').evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth }), true)
    await page.screenshot({ path: 'artifacts/permissions.png', animations: 'disabled' })
    await page.keyboard.press('Escape')
    await page.reload(); await page.locator('.welcome h1').waitFor()
    await page.locator('.recent-chat').filter({ hasText: '__cancel_command__' }).click()
    await page.getByRole('button', { name: 'Berechtigungen: Vollzugriff', exact: true }).waitFor()
    await page.locator('.new-chat-button').click()
    await page.getByRole('button', { name: 'Berechtigungen: Nachfragen', exact: true }).waitFor()
    await page.clock.setFixedTime(new Date(2026, 9, 30, 7, 0))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.getByRole('heading', { name: 'Guten Morgen', exact: true }).waitFor()
    await page.clock.setFixedTime(new Date(2026, 9, 30, 20, 0))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.getByRole('heading', { name: 'Guten Abend', exact: true }).waitFor()
    assert.deepEqual(errors, [])
    console.log('PASS safe defaults for new chats, compact permission menu and greetings following local time in Code mode')
    console.log(`AGENT E2E COMPLETE: ${requests.length} local mock requests; no paid API requests; isolated data ${directory}`)
  } catch (error) {
    if (page) { console.error('CURRENT UI:', (await page.locator('body').innerText().catch(() => '')).slice(-4000)); await page.screenshot({ path: 'artifacts/agent-failure.png' }).catch(() => {}) }
    throw error
  } finally {
    if (app) await app.close()
    server.closeAllConnections(); server.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
