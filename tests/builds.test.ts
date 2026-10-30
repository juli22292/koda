import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { ZipFile } from 'yazl'
import { inspectBuild, gradleRuntime } from '../src/main/build-plan'
import { extractToolArchive, jarKind } from '../src/main/build-archives'
import { Toolchains, trustedToolURL } from '../src/main/toolchains'
import { Builds, findBuildArtifacts } from '../src/main/builds'

async function temporary(t: { after(callback: () => Promise<void>): void }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'koda-build-'))
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'koda-build-')))
    await fs.rm(directory, { recursive: true, force: true })
  })
  return directory
}
async function files(root: string, values: Record<string, string | Buffer>) {
  for (const [name, content] of Object.entries(values)) { const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content) }
}
async function zip(values: Record<string, string | Buffer>, mode?: number): Promise<Buffer> {
  const archive = new ZipFile()
  for (const [name, content] of Object.entries(values)) archive.addBuffer(Buffer.from(content), name, mode ? { mode } : undefined)
  archive.end()
  const chunks: Buffer[] = []; for await (const chunk of archive.outputStream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

test('Maven resolves compiler properties, inherits local parents and detects wrapper versions', async t => {
  const root = await temporary(t)
  await files(root, {
    'pom.xml': '<project><properties><java.version>17</java.version></properties><modules><module>plugin</module></modules></project>',
    'plugin/pom.xml': '<project><parent><relativePath>../pom.xml</relativePath></parent><properties><maven.compiler.release>${java.version}</maven.compiler.release></properties></project>',
    'plugin/.mvn/wrapper/maven-wrapper.properties': 'distributionUrl=https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.16/apache-maven-3.9.16-bin.zip',
    [`plugin/${process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw'}`]: 'echo test',
  })
  const plan = await inspectBuild(root, { path: 'plugin' })
  assert.equal(plan.system, 'maven'); assert.equal(plan.javaVersion, 17); assert.equal(plan.version, '3.9.16')
  assert.match(plan.wrapper!, /mvnw/); assert.deepEqual(plan.tasks, ['package'])
})
test('Gradle Kotlin toolchains, wrapper runtime compatibility and multi-project roots are detected', async t => {
  const root = await temporary(t)
  await files(root, { 'server/build.gradle.kts': 'java { toolchain { languageVersion.set(JavaLanguageVersion.of(21)) } }', 'server/gradle/wrapper/gradle-wrapper.properties': 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.10.2-bin.zip' })
  const plan = await inspectBuild(root)
  assert.equal(plan.path, 'server'); assert.equal(plan.javaVersion, 21); assert.equal(plan.runtimeJava, 21); assert.equal(plan.version, '8.10.2')
  assert.equal(gradleRuntime('7.6.4', 21), 17)
  assert.equal(gradleRuntime('9.1.0', 8), 25)
  assert.equal(gradleRuntime('8.14.6', 8), 8)
  const differentRuntime = await inspectBuild(root, { javaVersion: 8, runtimeJavaVersion: 21 })
  assert.equal(differentRuntime.javaVersion, 8)
  assert.equal(differentRuntime.runtimeJava, 21)
  await assert.rejects(inspectBuild(root, { runtimeJavaVersion: 27 }), /Laufzeit-Java/)
})
test('explicit Java settings win over Minecraft API hints; missing settings use a reported fallback', async t => {
  const root = await temporary(t)
  await files(root, { 'pom.xml': '<project><properties><maven.compiler.release>17</maven.compiler.release></properties><dependencies><dependency><artifactId>paper-api</artifactId><version>1.21.8-R0.1-SNAPSHOT</version></dependency></dependencies></project>' })
  assert.equal((await inspectBuild(root)).javaVersion, 17)
  assert.equal((await inspectBuild(root, { javaVersion: 25 })).javaVersion, 25)
  await files(root, { 'pom.xml': '<project><dependencies><dependency><artifactId>paper-api</artifactId><version>1.21.8-R0.1-SNAPSHOT</version></dependency></dependencies></project>' })
  assert.equal((await inspectBuild(root)).javaVersion, 21)
  await files(root, { 'pom.xml': '<project/>' })
  assert.equal((await inspectBuild(root)).warnings.length, 1)
})
test('build inspection rejects external paths, XML entities, ambiguous builders and publishing tasks', async t => {
  const root = await temporary(t)
  await files(root, { 'pom.xml': '<project/>', 'build.gradle': "plugins { id 'java' }" })
  await assert.rejects(inspectBuild(root), /Maven und Gradle/)
  for (const task of ['deploy', 'clean', 'publish', 'plugin:publish', 'build; whoami', '-Danything=evil']) await assert.rejects(inspectBuild(root, { system: 'gradle', task }), /lokale Build-Ziele/)
  await assert.rejects(inspectBuild(root, { path: '../' }), /außerhalb/)
  await files(root, { 'pom.xml': '<!DOCTYPE x [<!ENTITY y SYSTEM "file:///secret">]><project/>' })
  await assert.rejects(inspectBuild(root, { system: 'maven' }), /XML/)
})
test('managed tools verify the official checksum, install atomically and reuse the cache offline', async t => {
  const root = await temporary(t)
  const bytes = await zip({ 'apache-maven-3.10.0/bin/mvn.cmd': '@echo off\r\necho test' })
  const checksum = createHash('sha512').update(bytes).digest('hex')
  let requests = 0
  const manager = new Toolchains(root, { environment: {}, fetch: (async input => { requests++; return String(input).endsWith('.sha512') ? new Response(checksum) : new Response(new Uint8Array(bytes)) }) as typeof fetch })
  const home = await manager.buildTool('maven', '3.10.0', new AbortController().signal, () => {})
  assert.equal((await fs.stat(path.join(home, 'bin/mvn.cmd'))).isFile(), true)
  assert.equal(requests, 2)
  assert.equal(await manager.buildTool('maven', '3.10.0', new AbortController().signal, () => {}), home)
  assert.equal(requests, 2)
  assert.deepEqual(await fs.readdir(path.join(root, '.work')), [])
})
test('bad downloads and unsafe redirects never become executable tools', async t => {
  const root = await temporary(t)
  const bytes = await zip({ 'apache-maven-3.10.0/bin/mvn.cmd': '@echo off' })
  const manager = new Toolchains(root, { environment: {}, fetch: (async input => String(input).endsWith('.sha512') ? new Response('a'.repeat(128)) : new Response(new Uint8Array(bytes))) as typeof fetch })
  await assert.rejects(manager.buildTool('maven', '3.10.0', new AbortController().signal, () => {}), /Prüfsumme/)
  await assert.rejects(fs.stat(path.join(root, 'maven-3.10.0')), { code: 'ENOENT' })
  assert.deepEqual(await fs.readdir(path.join(root, '.work')), [])
  for (const url of ['http://services.gradle.org/x', 'https://evil.example/file.zip', 'https://github.com/user/project/releases/download/x/a.zip', 'https://user:secret@repo.maven.apache.org/a.zip']) assert.throws(() => trustedToolURL(url), /Werkzeugquelle/)
  const redirect = new Toolchains(root, { fetch: (async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/unsafe' } })) as typeof fetch })
  await assert.rejects(redirect.buildTool('gradle', '8.14.6', new AbortController().signal, () => {}), /Werkzeugquelle/)
})
test('archive extraction refuses path traversal and symbolic links', async t => {
  const root = await temporary(t)
  const safe = await zip({ 'safe-entry.txt': 'data' })
  const traversal = Buffer.from(safe.toString('binary').replaceAll('safe-entry.txt', '../escaped.txt'), 'binary')
  await files(root, { 'traversal.zip': traversal, 'link.zip': await zip({ link: '../outside' }, 0o120777) })
  for (const file of ['traversal.zip', 'link.zip']) {
    const target = path.join(root, file + '-output'); await fs.mkdir(target)
    await assert.rejects(extractToolArchive(path.join(root, file), target, new AbortController().signal))
  }
  await assert.rejects(fs.stat(path.join(root, 'escaped.txt')), { code: 'ENOENT' })
})
test('JAR discovery prioritizes real plugin artifacts and excludes sources, originals and corrupt files', async t => {
  const root = await temporary(t)
  const plugin = await zip({ 'plugin.yml': 'name: Test', 'example/Main.class': 'compiled' })
  const library = await zip({ 'example/Main.class': 'compiled' })
  await files(root, { 'module/build/libs/plugin-all.jar': plugin, 'module/build/libs/plugin-plain.jar': library, 'module/build/libs/plugin-sources.jar': plugin, 'module/target/original-plugin.jar': plugin, 'module/target/broken.jar': 'broken', 'module/build/libs/notes.jar': await zip({ 'readme.txt': 'text' }) })
  const artifacts = await findBuildArtifacts(root, '.')
  assert.deepEqual(artifacts.map(value => value.path), ['module/build/libs/plugin-all.jar'])
  assert.equal(artifacts[0].kind, 'plugin')
  assert.equal(await jarKind(path.join(root, 'module/target/broken.jar')), undefined)
})
test('a project wrapper receives the selected JAVA_HOME and produces linked artifacts with live output', async t => {
  const root = await temporary(t)
  const project = path.join(root, "Plugin's folder"); await fs.mkdir(project)
  const bytes = await zip({ 'plugin.yml': 'name: Test', 'Main.class': 'compiled' })
  await files(project, {
    'build.gradle.kts': 'java { toolchain { languageVersion.set(JavaLanguageVersion.of(21)) } }',
    [process.platform === 'win32' ? 'gradlew.bat' : 'gradlew']: process.platform === 'win32' ? '@echo off\r\necho selected-java=%JAVA_HOME%\r\nnode build-fixture.cjs\r\nexit /b %errorlevel%' : '#!/bin/sh\necho selected-java=$JAVA_HOME\nnode build-fixture.cjs',
    'build-fixture.cjs': `const fs=require('node:fs');fs.mkdirSync('build/libs',{recursive:true});fs.writeFileSync('build/libs/plugin.jar',Buffer.from('${bytes.toString('base64')}','base64'));console.log('fixture-build-success')`,
  })
  if (process.platform !== 'win32') await fs.chmod(path.join(project, 'gradlew'), 0o755)
  const java = path.join(root, 'managed-jdk-21')
  const tools = { jdk: async (major: number) => { assert.equal(major, 21); return java }, buildTool: async () => { throw new Error('Wrapper must be preferred') } } as unknown as Toolchains
  const builds = new Builds(path.join(root, 'tools'), tools)
  const output: string[] = []
  const result = await builds.run(project, await builds.inspect(project), new AbortController().signal, value => output.push(value))
  assert.match(result.output, /fixture-build-success/)
  assert.ok(result.output.includes(java))
  assert.equal(result.artifacts[0].path, 'build/libs/plugin.jar')
  assert.ok(output.some(value => value.includes('fixture-build-success')))
})

test('changing the approved build toolchain requires a fresh inspection before any provisioning', async t => {
  const root = await temporary(t)
  await files(root, { 'build.gradle': 'java { toolchain { languageVersion = JavaLanguageVersion.of(17) } }' })
  let provisioned = false
  const tools = { jdk: async () => { provisioned = true; return 'unused' } } as unknown as Toolchains
  const builds = new Builds(path.join(root, 'tools'), tools)
  const plan = await builds.inspect(root)
  await files(root, { 'build.gradle': 'java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }' })
  await assert.rejects(builds.run(root, plan, new AbortController().signal, () => {}), /inzwischen geändert/)
  assert.equal(provisioned, false)
})

test('stopping a tool download cleans its partial archive without installing the tool', async t => {
  const root = await temporary(t)
  const controller = new AbortController()
  const manager = new Toolchains(root, { environment: {}, fetch: (async input => {
    if (String(input).endsWith('.sha512')) return new Response('a'.repeat(128))
    return new Response(new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new Uint8Array(2048)) }, cancel() {} }))
  }) as typeof fetch })
  await assert.rejects(manager.buildTool('maven', '3.10.0', controller.signal, line => { if (line.includes('geladen.')) controller.abort() }))
  await assert.rejects(fs.stat(path.join(root, 'maven-3.10.0')), { code: 'ENOENT' })
  assert.deepEqual(await fs.readdir(path.join(root, '.work')), [])
})
