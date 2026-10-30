import path from 'node:path'
import { promises as fs } from 'node:fs'
import { XMLParser } from 'fast-xml-parser'
import { readWorkspaceFile, workspacePath } from './workspace'

export const DEFAULT_MAVEN = '3.10.0'
export const DEFAULT_GRADLE = '8.14.6'
export const MODERN_GRADLE = '9.8.2'
export type BuildSystem = 'maven' | 'gradle'
export interface BuildOptions { path?: string; system?: BuildSystem; javaVersion?: number; runtimeJavaVersion?: number; task?: string }
export interface BuildPlan {
  path: string
  system: BuildSystem
  version: string
  javaVersion: number
  javaVersions: number[]
  runtimeJava: number
  runtimeJavaOverride?: number
  javaSource: string
  wrapper?: string
  tasks: string[]
  command: string
  warnings: string[]
}
const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value]
const slash = (value: string) => value.replaceAll('\\', '/')
export const validBuildVersion = (value: string) => /^\d+\.\d+(?:\.\d+)?(?:-rc-?\d+)?$/.test(value)
export function javaMajor(value: unknown): number | undefined {
  const found = String(value ?? '').trim().match(/^(?:1\.)?(\d{1,2})(?:[._+\-\s]|$)/)
  const major = found ? Number(found[1]) : 0
  return major >= 8 && major <= 30 ? major : undefined
}
export function properties(text: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null)
  for (const line of text.replace(/\\\r?\n\s*/g, '').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#!\s:=]+)\s*[=:]\s*(.*?)\s*$/)
    if (match) result[match[1]] = match[2].replace(/\\([:=! #\\])/g, '$1')
  }
  return result
}
export async function optionalFile(root: string, relative: string): Promise<string | undefined> {
  try { return await readWorkspaceFile(root, relative) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
function resolveValue(value: unknown, props: Record<string, unknown>): string {
  let result = String(value ?? '')
  for (let index = 0; index < 10 && /\$\{[^}]+\}/.test(result); index++) result = result.replace(/\$\{([^}]+)\}/g, (all, key) => props[key] === undefined ? all : String(props[key]))
  return result
}
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, processEntities: false })
async function mavenMetadata(root: string, directory: string, seen = new Set<string>()): Promise<{ versions: number[]; source?: string; text: string }> {
  const pomPath = slash(path.posix.join(directory, 'pom.xml'))
  if (seen.has(pomPath) || seen.size >= 25) return { versions: [], text: '' }
  seen.add(pomPath)
  const text = await optionalFile(root, pomPath) || ''
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Die POM enthält nicht unterstützte XML-Entitäten.')
  const project = parser.parse(text).project || {}
  let inherited: Record<string, unknown> = {}
  let parentMetadata: { versions: number[]; source?: string; text: string } | undefined
  if (project.parent && project.parent.relativePath !== '') {
    const parent = path.posix.normalize(path.posix.join(directory, project.parent.relativePath || '../pom.xml'))
    if (!parent.startsWith('../') && parent !== pomPath) {
      const parentText = await optionalFile(root, parent)
      if (parentText) {
        if (/<!DOCTYPE|<!ENTITY/i.test(parentText)) throw new Error('Nicht unterstützte XML-Entitäten in der Parent-POM.')
        inherited = parser.parse(parentText).project?.properties || {}
        parentMetadata = await mavenMetadata(root, path.posix.dirname(parent), seen)
      }
    }
  }
  const props = { ...inherited, ...project.properties }
  const plugins = [...array<any>(project.build?.plugins?.plugin), ...array<any>(project.build?.pluginManagement?.plugins?.plugin)]
  const compiler = plugins.find(plugin => plugin.artifactId === 'maven-compiler-plugin')?.configuration || {}
  const values = [props['maven.compiler.release'], compiler.release, props['java.version'], props['javaVersion'], props['maven.compiler.target'], compiler.target, props['maven.compiler.source'], compiler.source]
  const selected = values.map(value => javaMajor(resolveValue(value, props))).find(Boolean)
  const versions = selected ? [selected] : parentMetadata?.versions || []
  for (const module of array<string>(project.modules?.module)) {
    const nested = path.posix.normalize(path.posix.join(directory, module))
    if (nested.startsWith('../')) throw new Error('Ein Maven-Modul liegt außerhalb des ausgewählten Projekts.')
    const metadata = await mavenMetadata(root, nested, seen)
    versions.push(...metadata.versions)
  }
  return { versions, source: selected ? pomPath : parentMetadata?.source, text: text + '\n' + (parentMetadata?.text || '') }
}
function gradleJava(text: string, props: Record<string, string>): number[] {
  const versions: number[] = []
  const patterns = [
    /JavaLanguageVersion\.of\(\s*([\w.]+)\s*\)/g,
    /jvmToolchain\(\s*([\w.]+)\s*\)/g,
    /(?:sourceCompatibility|targetCompatibility|jvmTarget)\s*=?\s*(?:JavaVersion\.VERSION_|JvmTarget\.JVM_)?["']?(\d+(?:[._]\d+)?)/g,
    /(?:options\.)?release(?:\.set\()?\s*(?:=|\()?\s*(\d+)/g,
  ]
  for (const expression of patterns) for (const match of text.matchAll(expression)) {
    const major = javaMajor(props[match[1]] ?? match[1].replaceAll('_', '.'))
    if (major) versions.push(major)
  }
  return versions
}
export function gradleRuntime(version: string, target: number): number {
  const [major, minor] = version.split('.').map(Number)
  let min = major >= 9 ? 17 : 8
  let max = 8
  if (major >= 9) max = minor >= 8 ? 27 : minor >= 4 ? 26 : minor >= 1 ? 25 : 24
  else if (major === 8) max = minor >= 14 ? 24 : minor >= 10 ? 23 : minor >= 8 ? 22 : minor >= 5 ? 21 : minor >= 3 ? 20 : 19
  else if (major === 7) max = minor >= 6 ? 19 : minor >= 5 ? 18 : minor >= 3 ? 17 : 16
  else if (major === 6) max = minor >= 7 ? 15 : minor >= 3 ? 14 : 13
  else if (major === 5) max = minor >= 4 ? 12 : 11
  if (target >= min && target <= max) return target
  return [25, 21, 17, 11, 8].find(value => value >= min && value <= max) || min
}
function minecraftJava(text: string): number | undefined {
  // Dependency coordinates are only a fallback; explicit compiler/toolchain
  // declarations always win, and are never rewritten by the build service.
  const version = text.match(/(?:paper-api|spigot-api|bukkit|minecraft(?:Version|_version|\.version)?)[\s\S]{0,180}?(?:[:>="']|\s)((?:1\.\d+(?:\.\d+)?|2[6-9]\.\d+))(?:[-<"'\s]|$)/i)?.[1]
  if (!version) return undefined
  const [major, minor, patch = 0] = version.split('.').map(Number)
  if (major >= 26) return 25
  if (minor >= 21 || (minor === 20 && patch >= 5)) return 21
  if (minor >= 18) return 17
  if (minor === 17) return 16
  return 8
}
async function findBuildRoots(root: string, base: string, depth = 0): Promise<string[]> {
  if (depth > 2) return []
  const entries = await fs.readdir(await workspacePath(root, base), { withFileTypes: true })
  if (entries.some(entry => ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].includes(entry.name))) return [base]
  const found: string[] = []
  for (const entry of entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !['.git', '.gradle', 'node_modules', 'build', 'target', '.idea'].includes(entry.name)).slice(0, 60)) found.push(...await findBuildRoots(root, path.posix.join(base, entry.name), depth + 1))
  return found
}
export async function inspectBuild(root: string, options: BuildOptions = {}): Promise<BuildPlan> {
  let directory = slash(options.path || '.')
  const roots = await findBuildRoots(root, directory)
  if (!roots.length) throw new Error('Keine pom.xml oder Gradle-Builddatei gefunden. Zuerst das Projekt mit Maven oder Gradle anlegen.')
  if (roots.length > 1) throw new Error(`Mehrere Build-Projekte gefunden: ${roots.join(', ')}. Bitte den relativen Projektpfad angeben.`)
  directory = roots[0]
  const file = (name: string) => optionalFile(root, path.posix.join(directory, name))
  const [pom, gradle, kotlin, settings, kotlinSettings, gradleProps, mavenWrapper, gradleWrapper] = await Promise.all(['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradle.properties', '.mvn/wrapper/maven-wrapper.properties', 'gradle/wrapper/gradle-wrapper.properties'].map(file))
  const hasGradle = gradle !== undefined || kotlin !== undefined || settings !== undefined || kotlinSettings !== undefined
  if (pom !== undefined && hasGradle && !options.system) throw new Error('Maven und Gradle sind vorhanden. Das Build-System muss ausdrücklich ausgewählt werden.')
  const system = options.system || (pom !== undefined ? 'maven' : 'gradle')
  if (system === 'maven' ? pom === undefined : !hasGradle) throw new Error(`Keine Builddatei für ${system} im gewählten Ordner vorhanden.`)
  const warnings: string[] = []
  let javaVersions: number[], javaSource: string | undefined, text: string
  if (system === 'maven') {
    const metadata = await mavenMetadata(root, directory)
    javaVersions = metadata.versions; javaSource = metadata.source; text = metadata.text
  } else {
    text = [gradle, kotlin, settings, kotlinSettings].filter(Boolean).join('\n')
    const props = properties(gradleProps || '')
    javaVersions = gradleJava(text, props)
    for (const key of ['javaVersion', 'java_version', 'java.version', 'java.version.target']) { const major = javaMajor(props[key]); if (major) javaVersions.push(major) }
    javaSource = javaVersions.length ? (kotlin !== undefined ? 'build.gradle.kts' : 'build.gradle / gradle.properties') : undefined
  }
  const versionFile = (await file('.java-version')) || (await file('.tool-versions'))?.match(/(?:^|\n)java\s+(?:temurin-)?([^\s]+)/)?.[1]
  if (!javaVersions.length && versionFile) { const major = javaMajor(versionFile); if (major) { javaVersions.push(major); javaSource = '.java-version / .tool-versions' } }
  if (!javaVersions.length) { const inferred = minecraftJava(text); if (inferred) { javaVersions.push(inferred); javaSource = 'Minecraft-API im Build' } }
  if (options.javaVersion !== undefined) {
    if (!Number.isInteger(options.javaVersion) || options.javaVersion < 8 || options.javaVersion > 30) throw new Error('Ungültige Java-Version (8 bis 30).')
    javaVersions = [options.javaVersion]; javaSource = 'Explizite Build-Auswahl'
  }
  if (!javaVersions.length) { javaVersions = [21]; javaSource = 'Standard Java 21'; warnings.push('Keine Java-Version erkannt. Java 21 wird verwendet; bei Bedarf die Toolchain im Projekt explizit festlegen.') }
  javaVersions = [...new Set(javaVersions)].sort((a, b) => a - b)
  const javaVersion = Math.max(...javaVersions)
  const wrapperProps = properties((system === 'maven' ? mavenWrapper : gradleWrapper) || '')
  const configuredVersion = wrapperProps.distributionUrl?.match(system === 'maven' ? /apache-maven-([\d.]+)-bin\.zip/ : /gradle-([\d.]+)-(?:bin|all)\.zip/)?.[1]
  const version = configuredVersion || (system === 'maven' ? DEFAULT_MAVEN : javaVersion >= 25 ? MODERN_GRADLE : DEFAULT_GRADLE)
  if (!validBuildVersion(version)) throw new Error('Die konfigurierte Build-Version wird nicht unterstützt.')
  const wrapperName = system === 'maven' ? (process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw') : (process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
  const wrapper = (await file(wrapperName)) !== undefined ? wrapperName : undefined
  if (wrapperProps.distributionUrl && !configuredVersion && !wrapper) throw new Error('Die Wrapper-Version ist nicht erkennbar und das Wrapper-Skript fehlt. Bitte die Build-Konfiguration prüfen.')
  let runtimeJava = system === 'gradle' ? gradleRuntime(version, javaVersion) : javaVersion
  const daemonVersion = javaMajor(properties((await file('gradle/gradle-daemon-jvm.properties')) || '').toolchainVersion)
  if (system === 'gradle' && daemonVersion) {
    if (gradleRuntime(version, daemonVersion) !== daemonVersion) throw new Error('Die Java-Version der Gradle-Daemon-Konfiguration passt nicht zur Gradle-Version.')
    runtimeJava = daemonVersion
  }
  if (options.runtimeJavaVersion !== undefined) {
    if (!Number.isInteger(options.runtimeJavaVersion) || options.runtimeJavaVersion < 8 || options.runtimeJavaVersion > 30 || (system === 'gradle' && gradleRuntime(version, options.runtimeJavaVersion) !== options.runtimeJavaVersion)) throw new Error('Die gewählte Laufzeit-Java-Version passt nicht zum Build-Werkzeug.')
    runtimeJava = options.runtimeJavaVersion
  }
  const tasks = options.task ? options.task.trim().split(/\s+/) : [system === 'maven' ? 'package' : 'build']
  const allowedTasks = new Set(system === 'maven' ? ['package', 'verify', 'test', 'compile', 'test-compile'] : ['build', 'assemble', 'check', 'test', 'classes', 'jar', 'shadowJar', 'reobfJar', 'remapJar', 'buildPlugin'])
  if (tasks.length > 4 || tasks.some(task => !/^:?(?:[a-zA-Z_][\w-]*:)*[a-zA-Z_][\w-]*$/.test(task) || !allowedTasks.has(task.split(':').at(-1)!))) throw new Error('Bitte lokale Build-Ziele wie package, build oder shadowJar verwenden; keine Optionen, Veröffentlichung oder clean.')
  if (runtimeJava !== javaVersion) warnings.push(`Gradle ${version} startet mit Java ${runtimeJava}; Java ${javaVersion} wird zusätzlich als Compiler-Toolchain bereitgestellt.`)
  return { path: directory, system, version, javaVersion, javaVersions, runtimeJava, runtimeJavaOverride: options.runtimeJavaVersion, javaSource: javaSource!, wrapper, tasks, command: `${wrapper ? (process.platform === 'win32' ? '.\\' : './') + wrapper : system === 'maven' ? 'mvn' : 'gradle'} ${system === 'maven' ? '-B -ntp ' : '--no-daemon --console=plain '}${tasks.join(' ')}`, warnings }
}
