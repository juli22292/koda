import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { BuildArtifact, BuildResult } from '../shared/types'
import { inspectBuild, type BuildOptions, type BuildPlan } from './build-plan'
import { Toolchains } from './toolchains'
import { jarKind } from './build-archives'
import { runCommand } from './commands'
import { workspacePath } from './workspace'

export function quoteBuildArgument(value: string): string {
  return process.platform === 'win32' ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`
}
export async function findBuildArtifacts(root: string, directory: string): Promise<BuildArtifact[]> {
  const found: BuildArtifact[] = []
  let visited = 0
  const walk = async (relative: string, depth: number) => {
    if (depth > 9 || visited > 15_000) return
    const location = await workspacePath(root, relative)
    const entries = await fs.readdir(location, { withFileTypes: true })
    for (const entry of entries) {
      visited++
      if (visited > 15_000) break
      if (entry.isSymbolicLink() || ['.git', '.gradle', '.mvn', '.idea', 'node_modules', '.venv', 'src', 'classes', 'test-classes', 'generated-sources', 'generated-test-sources', 'dependency'].includes(entry.name)) continue
      const file = path.posix.join(relative, entry.name)
      if (entry.isDirectory()) await walk(file, depth + 1)
      else if (entry.isFile() && /(?:^|\/)(?:target(?:\/[^/]+)*|build\/libs)\/[^/]+\.jar$/i.test(file) && !/(?:^|\/)(?:original-|original\.jar)|-(?:sources|javadoc|tests|test-fixtures)\.jar$/i.test(file)) {
        const absolute = await workspacePath(root, file)
        const kind = await jarKind(absolute)
        if (kind) found.push({ name: entry.name, path: file, size: (await fs.stat(absolute)).size, kind })
      }
    }
  }
  await walk(directory, 0)
  return found.filter(artifact => !artifact.name.endsWith('-plain.jar') || !found.some(other => other !== artifact && path.posix.dirname(other.path) === path.posix.dirname(artifact.path) && other.kind === 'plugin'))
    .sort((a, b) => Number(b.kind === 'plugin') - Number(a.kind === 'plugin') || a.path.localeCompare(b.path)).slice(0, 40)
}
export class Builds {
  readonly tools: Toolchains
  private active = new Set<string>()
  constructor(readonly directory: string, tools?: Toolchains) { this.tools = tools || new Toolchains(directory) }
  inspect(root: string, options: BuildOptions = {}) { return inspectBuild(root, options) }
  async run(root: string, plan: BuildPlan, signal: AbortSignal, onOutput: (output: string) => void): Promise<BuildResult> {
    const directory = await workspacePath(root, plan.path)
    const key = process.platform === 'win32' ? directory.toLowerCase() : directory
    if (this.active.has(key)) throw new Error('Für dieses Projekt läuft bereits ein Build. Bitte zuerst warten oder stoppen.')
    this.active.add(key)
    try {
      const current = await this.inspect(root, { path: plan.path, system: plan.system, task: plan.tasks.join(' '), javaVersion: plan.javaSource === 'Explizite Build-Auswahl' ? plan.javaVersion : undefined, runtimeJavaVersion: plan.runtimeJavaOverride })
      if (['path', 'system', 'version', 'javaVersion', 'runtimeJava', 'wrapper'].some(field => (current as any)[field] !== (plan as any)[field]) || current.javaVersions.join(',') !== plan.javaVersions.join(',')) throw new Error('Die Build-Konfiguration wurde inzwischen geändert. Bitte erneut prüfen und kompilieren.')
      return await this.execute(root, plan, signal, onOutput)
    } finally { this.active.delete(key) }
  }
  private async execute(root: string, plan: BuildPlan, signal: AbortSignal, onOutput: (output: string) => void): Promise<BuildResult> {
    const cwd = await workspacePath(root, plan.path)
    let setup = ''
    const log = (line: string) => { setup = (setup + line + '\n').slice(-12_000); onOutput(setup) }
    log(`${plan.system === 'maven' ? 'Maven' : 'Gradle'} ${plan.version} · Java ${plan.javaVersion} · ${plan.javaSource}`)
    for (const warning of plan.warnings) log(warning)
    const homes = new Map<number, string>()
    for (const major of [...new Set([plan.runtimeJava, ...plan.javaVersions])]) homes.set(major, await this.tools.jdk(major, signal, log))
    signal.throwIfAborted()
    const runtime = homes.get(plan.runtimeJava)!
    let executable: string
    if (plan.wrapper) {
      executable = await workspacePath(root, path.posix.join(plan.path, plan.wrapper))
      log(`Projekt-Wrapper ${plan.wrapper} verwenden.`)
    } else {
      const home = await this.tools.buildTool(plan.system, plan.version, signal, log, runtime)
      executable = path.join(home, 'bin', plan.system === 'maven' ? 'mvn.cmd' : 'gradle.bat')
    }
    const cache = path.join(this.directory, 'cache')
    await fs.mkdir(cache, { recursive: true })
    const javaPaths = [...homes.values()]
    const env = {
      JAVA_HOME: runtime,
      Path: [path.join(runtime, 'bin'), process.env.Path || process.env.PATH || ''].join(path.delimiter),
      PATH: [path.join(runtime, 'bin'), process.env.Path || process.env.PATH || ''].join(path.delimiter),
      GRADLE_USER_HOME: path.join(cache, 'gradle'),
      MAVEN_USER_HOME: path.join(cache, 'maven'),
    }
    const [gradleMajor, gradleMinor] = plan.version.split('.').map(Number)
    const toolchainFlag = gradleMajor > 9 || (gradleMajor === 9 && gradleMinor >= 7) ? '-D' : '-P'
    const args = plan.system === 'maven' ? ['-B', '-ntp', ...plan.tasks, `-Dmaven.repo.local=${path.join(cache, 'maven-repository')}`] : ['--no-daemon', '--console=plain', ...plan.tasks, `-Dorg.gradle.java.home=${runtime}`, `${toolchainFlag}org.gradle.java.installations.paths=${javaPaths.join(',')}`]
    if (plan.system === 'maven') {
      const buildDirectory = path.join(cache, 'projects', createHash('sha256').update(cwd).digest('hex').slice(0, 20))
      await fs.mkdir(buildDirectory, { recursive: true })
      const toolchains = path.join(buildDirectory, 'toolchains.xml')
      const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
      await fs.writeFile(toolchains, `<?xml version="1.0" encoding="UTF-8"?><toolchains>${[...homes].flatMap(([major, home]) => (major === 8 ? ['8', '1.8'] : [String(major)]).map(version => `<toolchain><type>jdk</type><provides><version>${version}</version></provides><configuration><jdkHome>${xml(home)}</jdkHome></configuration></toolchain>`)).join('')}</toolchains>`)
      args.push('-t', toolchains)
    }
    const command = `${process.platform === 'win32' ? '& ' : ''}${quoteBuildArgument(executable)} ${args.map(quoteBuildArgument).join(' ')}`
    log(`Build starten: ${plan.command}`)
    let output: string
    try {
      output = await runCommand(command, { cwd, env, signal, timeoutMs: 15 * 60_000, onOutput: value => onOutput((setup + '\n' + value).slice(-24_000)) })
    } catch (error) {
      if (signal.aborted) throw error
      throw new Error((setup + '\n' + (error instanceof Error ? error.message : String(error))).slice(-24_000))
    }
    signal.throwIfAborted()
    const jarTasks = new Set(['package', 'verify', 'build', 'assemble', 'jar', 'shadowJar', 'reobfJar', 'remapJar', 'buildPlugin'])
    const artifacts = plan.tasks.some(task => jarTasks.has(task.split(':').at(-1)!)) ? await findBuildArtifacts(root, plan.path) : []
    const summary = artifacts.length ? `\n\nBuild erfolgreich. ${artifacts.length} JAR-Datei(en):\n${artifacts.map(artifact => `${artifact.path} (${artifact.kind === 'plugin' ? 'Plugin' : 'JAR'}, ${artifact.size} Bytes)`).join('\n')}` : '\n\nBuild erfolgreich, aber keine auslieferbare JAR gefunden. Build-Ziel und Ausgabeverzeichnis prüfen.'
    return { output: (setup + '\n' + output).slice(-21_000) + summary, artifacts }
  }
}
