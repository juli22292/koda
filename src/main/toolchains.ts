import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import { extractToolArchive, insidePath } from './build-archives'
import { validBuildVersion } from './build-plan'
import { runCommand } from './commands'

const execute = promisify(execFile)
interface Archive { url: string; checksum: string; algorithm: 'sha256' | 'sha512'; version: string }
interface Dependencies { fetch?: typeof fetch; environment?: NodeJS.ProcessEnv }
const allowedHosts = new Set(['api.adoptium.net', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com', 'services.gradle.org', 'downloads.gradle.org', 'repo.maven.apache.org'])
export function trustedToolURL(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowedHosts.has(url.hostname)) throw new Error('Die Werkzeugquelle ist nicht zugelassen.')
  if (url.hostname === 'github.com' && !/^\/(?:adoptium\/temurin\d+-binaries|gradle\/gradle-distributions)\/releases\/download\//.test(url.pathname)) throw new Error('Diese GitHub-Werkzeugquelle wird nicht unterstützt.')
  return url
}
export class Toolchains {
  private fetcher: typeof fetch
  private environment: NodeJS.ProcessEnv
  private pending = new Map<string, Promise<string>>()
  constructor(readonly directory: string, dependencies: Dependencies = {}) {
    this.fetcher = dependencies.fetch || fetch
    this.environment = dependencies.environment || process.env
  }
  private async request(value: string, signal: AbortSignal): Promise<Response> {
    let url = trustedToolURL(value)
    for (let redirect = 0; redirect < 8; redirect++) {
      signal.throwIfAborted()
      const response = await this.fetcher(url, { redirect: 'manual', headers: { 'User-Agent': 'Koda-Build/0.2', Accept: '*/*' }, signal })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel()
        if (!location) throw new Error('Werkzeug-Download ohne Weiterleitungsziel.')
        url = trustedToolURL(new URL(location, url).href); continue
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Die Werkzeugquelle ${url.hostname} antwortet mit HTTP ${response.status}.`) }
      return response
    }
    throw new Error('Zu viele Weiterleitungen beim Werkzeug-Download.')
  }
  private async metadata(url: string, signal: AbortSignal): Promise<string> {
    const response = await this.request(url, AbortSignal.any([signal, AbortSignal.timeout(30_000)]))
    if (!response.body) throw new Error('Leere Werkzeug-Antwort.')
    let size = 0; const chunks: Buffer[] = []
    for await (const chunk of Readable.fromWeb(response.body as any)) {
      size += chunk.length; if (size > 2 * 1024 ** 2) throw new Error('Werkzeug-Metadaten sind zu groß.')
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks).toString('utf8')
  }
  private async cached(key: string, executable: string): Promise<string | undefined> {
    const target = insidePath(this.directory, key)
    try {
      if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('Der Werkzeugordner darf kein Dateiverweis sein.')
      const marker = JSON.parse(await fs.readFile(path.join(target, 'koda-tool.json'), 'utf8'))
      const home = insidePath(target, marker.home)
      // Ancestor folders may be junctions on Windows (including hosted CI
      // temp folders). Compare canonical paths on both sides of the boundary.
      const realTarget = await fs.realpath(target)
      insidePath(realTarget, path.relative(realTarget, await fs.realpath(home)))
      const file = path.join(home, executable)
      insidePath(realTarget, path.relative(realTarget, await fs.realpath(file)))
      if ((await fs.stat(file)).isFile() && (!key.startsWith('jdk-') || (await fs.stat(path.join(home, 'bin/javac.exe'))).isFile())) return home
    } catch (error) { if ((error as Error).message.includes('Dateiverweis')) throw error }
    return undefined
  }
  private async removeWork(work: string): Promise<void> {
    const workRoot = path.join(this.directory, '.work')
    insidePath(workRoot, path.relative(workRoot, work))
    // Resolve the parent first; never follow a tool-cache junction for cleanup.
    const realRoot = await fs.realpath(this.directory)
    const realParent = await fs.realpath(path.dirname(work))
    insidePath(realRoot, path.relative(realRoot, realParent))
    await fs.rm(work, { recursive: true, force: true })
  }
  private async install(key: string, executable: string, descriptor: () => Promise<Archive>, signal: AbortSignal, log: (line: string) => void): Promise<string> {
    const cached = await this.cached(key, executable)
    if (cached) { log(`${key} aus dem Koda-Werkzeugordner verwenden.`); return cached }
    if (this.pending.has(key)) return this.pending.get(key)!
    const pending = (async () => {
      if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Die automatische Werkzeugeinrichtung ist für Windows x64 verfügbar.')
      const archive = await descriptor()
      if (!new RegExp(`^[a-fA-F0-9]{${archive.algorithm === 'sha256' ? 64 : 128}}$`).test(archive.checksum)) throw new Error('Keine gültige Prüfsumme für das Werkzeug vorhanden.')
      await fs.mkdir(path.join(this.directory, '.work'), { recursive: true })
      const realRoot = await fs.realpath(this.directory)
      insidePath(realRoot, path.relative(realRoot, await fs.realpath(path.join(this.directory, '.work'))))
      const work = await fs.mkdtemp(path.join(this.directory, '.work', 'install-'))
      const downloaded = path.join(work, 'download.zip'), unpacked = path.join(work, 'unpacked')
      try {
        log(`${key} ${archive.version} herunterladen …`)
        const transferSignal = AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)])
        const response = await this.request(archive.url, transferSignal)
        if (!response.body) throw new Error('Das Werkzeugarchiv ist leer.')
        const expected = Number(response.headers.get('content-length'))
        let received = 0, lastLog = 0
        const hash = createHash(archive.algorithm)
        const progress = new Transform({ transform(chunk, _encoding, callback) {
          received += chunk.length
          if (received > 700 * 1024 ** 2) return callback(new Error('Das Werkzeugarchiv überschreitet 700 MB.'))
          hash.update(chunk)
          if (Date.now() - lastLog > 2000) { lastLog = Date.now(); log(`${key}: ${expected ? Math.min(100, Math.floor(received / expected * 100)) + ' %' : Math.floor(received / 1024 ** 2) + ' MB'} geladen.`) }
          callback(null, chunk)
        } })
        await pipeline(Readable.fromWeb(response.body as any), progress, createWriteStream(downloaded, { flags: 'wx' }), { signal: transferSignal })
        if (hash.digest('hex').toLowerCase() !== archive.checksum.toLowerCase()) throw new Error('Die Werkzeug-Prüfsumme stimmt nicht. Der Download wird verworfen.')
        signal.throwIfAborted(); log(`${key}: Prüfsumme bestätigt, Archiv entpacken …`)
        await fs.mkdir(unpacked)
        await extractToolArchive(downloaded, unpacked, signal)
        const folders = (await fs.readdir(unpacked, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => entry.name)
        const homeName = (await Promise.all(folders.map(async folder => (await fs.stat(path.join(unpacked, folder, executable)).catch(() => undefined))?.isFile() ? folder : undefined))).find(Boolean)
        if (!homeName) throw new Error('Das Werkzeugarchiv enthält nicht die erwartete ausführbare Datei.')
        if (key.startsWith('jdk-') && !(await fs.stat(path.join(unpacked, homeName, 'bin/javac.exe')).catch(() => undefined))?.isFile()) throw new Error('Das heruntergeladene Java enthält keinen Compiler.')
        await fs.writeFile(path.join(unpacked, 'koda-tool.json'), JSON.stringify({ home: homeName, version: archive.version, checksum: archive.checksum, source: archive.url }, null, 2))
        signal.throwIfAborted()
        const destination = insidePath(this.directory, key)
        const existing = await fs.lstat(destination).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return undefined })
        if (existing) {
          const ready = await this.cached(key, executable)
          if (ready) return ready
          if (existing.isSymbolicLink()) throw new Error('Unsicherer Werkzeugordner.')
          insidePath(await fs.realpath(this.directory), path.relative(await fs.realpath(this.directory), await fs.realpath(destination)))
          await fs.rename(destination, path.join(work, 'previous'))
        }
        await fs.rename(unpacked, destination)
        log(`${key} ist bereit.`)
        return path.join(destination, homeName)
      } finally { await this.removeWork(work) }
    })()
    this.pending.set(key, pending)
    try { return await pending } finally { this.pending.delete(key) }
  }
  async jdk(major: number, signal: AbortSignal, log: (line: string) => void): Promise<string> {
    if (!Number.isInteger(major) || major < 8 || major > 30) throw new Error('Ungültige JDK-Version.')
    const candidates = new Set<string>()
    for (const [name, value] of Object.entries(this.environment)) if (/^JAVA.*HOME/i.test(name) && value) candidates.add(value)
    for (const directory of (this.environment.Path || this.environment.PATH || '').split(path.delimiter).filter(Boolean)) candidates.add(path.dirname(directory))
    for (const home of candidates) {
      signal.throwIfAborted()
      const compiler = path.join(home, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac')
      if (!(await fs.stat(compiler).catch(() => undefined))?.isFile()) continue
      try {
        const { stdout, stderr } = await execute(compiler, ['-version'], { windowsHide: true, timeout: 8000, maxBuffer: 8192, signal })
        const actual = (stdout + stderr).match(/javac\s+(?:1\.)?(\d+)/)?.[1]
        if (Number(actual) === major) { log(`Vorhandenes JDK ${major} verwenden: ${home}`); return home }
      } catch { signal.throwIfAborted() }
    }
    return this.install(`jdk-${major}`, 'bin/java.exe', async () => {
      const metadata = JSON.parse(await this.metadata(`https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse`, signal))
      const asset = metadata.find((value: any) => value.binary?.package?.name?.endsWith('.zip'))
      if (!asset) throw new Error(`Kein Windows-JDK ${major} bei Adoptium verfügbar.`)
      return { url: asset.binary.package.link, checksum: asset.binary.package.checksum, algorithm: 'sha256', version: asset.version?.semver || String(major) }
    }, signal, log)
  }
  async buildTool(system: 'maven' | 'gradle', version: string, signal: AbortSignal, log: (line: string) => void, javaHome?: string): Promise<string> {
    if (!validBuildVersion(version)) throw new Error('Ungültige Build-Werkzeugversion.')
    const executable = system === 'maven' ? 'bin/mvn.cmd' : 'bin/gradle.bat'
    const cached = await this.cached(`${system}-${version}`, executable)
    if (cached) { log(`${system}-${version} aus dem Koda-Werkzeugordner verwenden.`); return cached }
    const candidates = new Set<string>()
    for (const name of system === 'maven' ? ['MAVEN_HOME', 'M2_HOME'] : ['GRADLE_HOME']) if (this.environment[name]) candidates.add(this.environment[name]!)
    for (const directory of (this.environment.Path || this.environment.PATH || '').split(path.delimiter).filter(Boolean)) candidates.add(path.dirname(directory))
    for (const home of candidates) {
      const command = path.join(home, executable)
      if (!(await fs.stat(command).catch(() => undefined))?.isFile()) continue
      try {
        const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
        const output = await runCommand(`& ${quote(command)} '--version'`, { cwd: home, signal, timeoutMs: 8000, onOutput: () => {}, env: javaHome ? { JAVA_HOME: javaHome } : undefined })
        if (output.match(system === 'maven' ? /Apache Maven\s+([\d.]+)/ : /Gradle\s+([\d.]+)/)?.[1] === version) { log(`Vorhandenes ${system} ${version} verwenden: ${home}`); return home }
      } catch { signal.throwIfAborted() }
    }
    return this.install(`${system}-${version}`, executable, async () => {
      const url = system === 'maven' ? `https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/${version}/apache-maven-${version}-bin.zip` : `https://services.gradle.org/distributions/gradle-${version}-bin.zip`
      const algorithm = system === 'maven' ? 'sha512' : 'sha256'
      const checksum = (await this.metadata(`${url}.${algorithm}`, signal)).trim().split(/\s/)[0]
      return { url, algorithm, checksum, version }
    }, signal, log)
  }
}
