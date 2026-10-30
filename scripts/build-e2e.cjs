const { _electron: electron } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { execFileSync } = require('node:child_process')

async function until(check, message, timeout = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    try { if (await check()) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 60))
  }
  throw new Error(message)
}
const fixedSource = 'public class NativePlugin { public String hello() { return "Koda"; } }'
const requests = []
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw); requests.push(body)
  const last = body.messages.findLastIndex(message => message.role === 'user')
  const user = String(body.messages[last].content)
  const tools = body.messages.slice(last + 1).filter(message => message.role === 'tool')
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const delta = (value, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'build-test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: value, finish_reason }] })}\n\n`)
  const text = content => { delta({ role: 'assistant', content }); delta({}, 'stop'); res.end('data: [DONE]\n\n') }
  const call = (name, args) => { delta({ role: 'assistant', tool_calls: [{ index: 0, id: `build-tool-${requests.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }); delta({}, 'tool_calls'); res.end('data: [DONE]\n\n') }
  if (!tools.length) return call('inspect_build', { path: '.' })
  if (user === '__inspect__') return text('Build-Umgebung lesend geprüft.')
  if (tools.length === 1) return call('build_project', { path: '.' })
  if (/abgelehnt/.test(String(tools[1]?.content))) return text('Build wurde nicht gestartet.')
  if (user === '__compile__' && tools.length === 2) return call('write_file', { path: 'src/main/java/NativePlugin.java', content: fixedSource })
  if (user === '__compile__' && tools.length === 3) return call('build_project', { path: '.' })
  text('Plugin erfolgreich kompiliert.')
})

;(async () => {
  let javaHome, javaVersion
  const candidates = Object.entries(process.env).filter(([name]) => /^JAVA.*HOME/i.test(name)).map(([, value]) => value)
  for (const candidate of candidates) {
    try {
      const version = execFileSync(path.join(candidate, 'bin/javac.exe'), ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 8000 }).match(/javac\s+(\d+)/)?.[1]
      if (['17', '21'].includes(version)) { javaHome = candidate; javaVersion = Number(version); break }
    } catch {}
  }
  if (!javaHome) throw new Error('Der lokale Build-UI-Test benötigt ein vorhandenes JDK 17 oder 21 (JAVA_HOME). Der separate build:smoke-Test prüft echte Downloads.')
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'koda-build-e2e-'))
  const project = path.join(root, "Plugin's project"), data = path.join(root, 'data')
  await fs.mkdir(path.join(project, 'src/main/java'), { recursive: true })
  await fs.mkdir(path.join(project, 'gradle/wrapper'), { recursive: true })
  await fs.writeFile(path.join(project, 'build.gradle.kts'), `plugins { java }\njava { toolchain { languageVersion.set(JavaLanguageVersion.of(${javaVersion})) } }`)
  await fs.writeFile(path.join(project, 'gradle/wrapper/gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.6-bin.zip')
  await fs.writeFile(path.join(project, 'gradlew.bat'), '@echo off\r\nnode "%~dp0build-fixture.cjs"\r\nexit /b %errorlevel%')
  await fs.writeFile(path.join(project, 'src/main/java/NativePlugin.java'), 'public class NativePlugin { invalid java source }')
  await fs.writeFile(path.join(project, 'build-fixture.cjs'), `
const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');
fs.writeFileSync('build-count.txt',String(Number(fs.existsSync('build-count.txt')?fs.readFileSync('build-count.txt','utf8'):0)+1));
console.log('Live-Build mit Java aus '+process.env.JAVA_HOME);
setTimeout(()=>{try{
  fs.mkdirSync('build/classes',{recursive:true});fs.mkdirSync('build/libs',{recursive:true});
  execFileSync(path.join(process.env.JAVA_HOME,'bin/javac.exe'),['-d','build/classes','src/main/java/NativePlugin.java'],{stdio:'inherit',windowsHide:true});
  fs.writeFileSync('build/classes/plugin.yml','name: NativeBuildFixture\\nversion: 1.0\\nmain: NativePlugin\\n');
  execFileSync(path.join(process.env.JAVA_HOME,'bin/jar.exe'),['cf','build/libs/NativePlugin.jar','-C','build/classes','.'],{stdio:'inherit',windowsHide:true});
  console.log('BUILD SUCCESSFUL');
}catch(error){process.exitCode=1}},900)
`)
  const env = { ...process.env, JAVA_HOME: javaHome, KODA_USER_DATA: data }; delete env.ELECTRON_RUN_AS_NODE
  let app, page
  const errors = []
  try {
    app = await electron.launch({ executablePath: process.env.KODA_TEST_EXE ? path.resolve(process.env.KODA_TEST_EXE) : require('electron'), args: process.env.KODA_TEST_EXE ? [] : [path.resolve('.')], env })
    page = await app.firstWindow(); page.setDefaultTimeout(20000)
    page.on('pageerror', error => errors.push(error.message))
    await page.locator('.welcome h1').waitFor()
    await page.evaluate(async url => { await window.koda.saveProvider('custom', { model: 'test', baseURL: url }); await window.koda.saveSettings({ defaultProvider: 'custom', theme: 'dark' }) }, `http://127.0.0.1:${server.address().port}/v1`)
    await page.reload(); await page.locator('.welcome h1').waitFor()
    await app.evaluate(({ dialog, shell }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
      shell.showItemInFolder = file => { global.__revealedArtifact = file }
    }, project)
    await page.locator('.open-project-tile').click()
    await page.getByRole('button', { name: 'Dateiansicht schließen' }).click()
    const send = async value => { await page.getByRole('textbox', { name: 'Nachricht an Koda' }).fill(value); await page.getByRole('button', { name: 'Nachricht senden' }).click() }
    const idle = () => until(() => page.getByRole('button', { name: 'Antwort stoppen' }).count().then(count => count === 0), 'Build chat did not finish')
    await send('__compile__')
    await page.getByRole('button', { name: 'Kompilieren', exact: true }).waitFor()
    assert.equal(await page.locator('.command-card.pending').count(), 1)
    await assert.rejects(fs.stat(path.join(project, 'build-count.txt')), { code: 'ENOENT' })
    await assert.rejects(fs.stat(path.join(data, 'tools')), { code: 'ENOENT' })
    await page.getByRole('button', { name: 'Ablehnen', exact: true }).click()
    await page.getByText('Build wurde nicht gestartet.', { exact: true }).waitFor(); await idle()
    await assert.rejects(fs.stat(path.join(project, 'build-count.txt')), { code: 'ENOENT' })
    console.log('PASS inspection is read-only; denied builds neither install tools nor execute project code')

    await send('__compile__')
    await page.getByRole('button', { name: 'Kompilieren', exact: true }).click()
    await page.getByRole('button', { name: 'Änderung übernehmen', exact: true }).waitFor()
    assert.equal(await page.locator('.command-card.error').count(), 1)
    await page.getByRole('button', { name: 'Änderung übernehmen', exact: true }).click()
    await page.getByRole('button', { name: 'Kompilieren', exact: true }).click()
    await page.getByRole('button', { name: 'Im Ordner anzeigen', exact: true }).waitFor()
    await page.getByText('Plugin erfolgreich kompiliert.', { exact: true }).waitFor(); await idle()
    assert.equal(await fs.readFile(path.join(project, 'build-count.txt'), 'utf8'), '2')
    const compiled = await fs.readFile(path.join(project, 'build/classes/NativePlugin.class'))
    assert.equal(compiled.readUInt16BE(6), javaVersion + 44)
    assert.equal(await page.locator('.build-artifact strong').innerText(), 'NativePlugin.jar')
    await page.getByRole('button', { name: 'Im Ordner anzeigen', exact: true }).click()
    assert.equal(await app.evaluate(() => global.__revealedArtifact), path.join(project, 'build/libs/NativePlugin.jar'))
    await fs.mkdir('artifacts', { recursive: true })
    await page.screenshot({ path: 'artifacts/build-result.png', animations: 'disabled' })
    await page.evaluate(async () => {
      const project = (await window.koda.getData()).projects[0]
      try { await window.koda.revealArtifact(project.id, '../outside.jar'); throw new Error('outside path was accepted') } catch (error) { if (!String(error).includes('außerhalb')) throw error }
    })
    console.log('PASS compiler failure, approved repair, successful rebuild, actual bytecode version, JAR card and validated folder reveal')

    await page.locator('.project-item').click(); await page.getByRole('button', { name: 'Dateiansicht schließen' }).click()
    await page.getByRole('button', { name: 'Berechtigungen: Nachfragen', exact: true }).click()
    await page.getByRole('menuitemradio', { name: /^Vollzugriff/ }).click()
    await send('__full_compile__')
    await until(() => page.locator('.command-card.running .terminal-output').innerText().then(text => text.includes('Live-Build mit Java')), 'No live build output')
    assert.equal(await page.locator('.approval-actions').count(), 0)
    await page.screenshot({ path: 'artifacts/build-running.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Im Ordner anzeigen', exact: true }).waitFor(); await idle()
    assert.equal(await fs.readFile(path.join(project, 'build-count.txt'), 'utf8'), '3')
    await page.getByRole('button', { name: 'Berechtigungen: Vollzugriff', exact: true }).click()
    await page.getByRole('menuitemradio', { name: /^Nur lesen/ }).click()
    await send('__inspect__'); await page.getByText('Build-Umgebung lesend geprüft.', { exact: true }).waitFor(); await idle()
    assert.deepEqual(requests.at(-1).tools.map(tool => tool.function.name).sort(), ['inspect_build', 'list_files', 'read_file'])
    assert.equal(await fs.readFile(path.join(project, 'build-count.txt'), 'utf8'), '3')
    assert.deepEqual(errors, [])
    console.log('PASS full-access builds without prompts, live build animation and read-only mode without executable build tools')
    console.log(`BUILD E2E COMPLETE: ${requests.length} local mock requests; local JDK ${javaVersion}; no paid API or download requests; isolated data ${root}`)
  } catch (error) {
    if (page) { console.error('CURRENT UI:', (await page.locator('body').innerText().catch(() => '')).slice(-6000)); await page.screenshot({ path: 'artifacts/build-failure.png' }).catch(() => {}) }
    throw error
  } finally { if (app) await app.close(); server.closeAllConnections(); server.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
