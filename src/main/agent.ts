import { streamText, stepCountIs, tool, type ModelMessage, type LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createXai } from '@ai-sdk/xai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'
import { runCommand } from './commands'
import { permissionPolicy } from '../shared/permissions'
import { effortErrorCapabilities, effortRequestOptions, parseModelCapabilities } from '../shared/effort'
import { activityClock } from '../shared/activity-time'
import type { BuildResult, ChatEvent, ChatRequest, ToolActivity, ProviderConfig, ModelCapabilities } from '../shared/types'
import type { Builds } from './builds'
import { listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile, workspacePath } from './workspace'
import type { Store } from './store'

export function createModel(config: ProviderConfig, key: string): LanguageModel {
  const options = { apiKey: key, baseURL: config.baseURL }
  switch (config.id) {
    case 'openai': return createOpenAI(options).responses(config.model)
    case 'anthropic': return createAnthropic(options)(config.model)
    case 'google': return createGoogle(options)(config.model)
    case 'xai': return createXai(options).responses(config.model)
    case 'custom': return createOpenAICompatible({ ...options, name: 'custom', apiKey: key || undefined })(config.model)
    case 'unorouter': return createOpenAICompatible({ ...options, name: 'unorouter' })(config.model)
  }
}
export async function fetchModels(config: ProviderConfig, key: string): Promise<string[]> {
  return (await fetchModelCatalog(config, key)).models
}
export async function fetchModelCatalog(config: ProviderConfig, key: string): Promise<{ models: string[]; modelCapabilities: Record<string, ModelCapabilities> }> {
  if (!key && config.id !== 'custom') throw new Error('Bitte zuerst einen API-Key speichern.')
  const url = `${config.baseURL}/models${config.id === 'google' ? '?pageSize=1000' : ''}`
  const headers: Record<string, string> = config.id === 'anthropic'
    ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    : config.id === 'google' ? { 'x-goog-api-key': key } : key ? { Authorization: `Bearer ${key}` } : {}
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' })
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Der API-Key wurde nicht akzeptiert. Prüfe Key und Berechtigungen.' : `Der Anbieter antwortet mit HTTP ${response.status}.`)
  const body = await response.json() as { data?: { id: string; [key: string]: unknown }[]; models?: { name: string; supportedGenerationMethods?: string[] }[] }
  const models = (config.id === 'google'
    ? body.models?.filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent')).map(m => m.name.replace(/^models\//, ''))
    : body.data?.map(m => m.id))?.filter(id => typeof id === 'string').sort() ?? []
  const modelCapabilities: Record<string, ModelCapabilities> = Object.create(null)
  if (config.id === 'unorouter' || config.id === 'custom') for (const item of body.data || []) {
    const capabilities = parseModelCapabilities(item)
    if (typeof item.id === 'string' && capabilities) modelCapabilities[item.id] = capabilities
  }
  return { models, modelCapabilities }
}
interface Run { controller: AbortController; approvals: Map<string, (approved: boolean) => void> }
export class Agent {
  private runs = new Map<string, Run>()
  get isRunning() { return this.runs.size > 0 }
  constructor(private store: Store, private emit: (event: ChatEvent) => void, private builds: Builds) {}
  stop(requestId: string) {
    const run = this.runs.get(requestId)
    if (!run) return
    run.controller.abort()
    run.approvals.forEach(resolve => resolve(false))
    run.approvals.clear()
  }
  stopAll() { for (const id of this.runs.keys()) this.stop(id) }
  approve(requestId: string, toolId: string, approved: boolean) {
    this.runs.get(requestId)?.approvals.get(toolId)?.(approved === true)
  }
  async start(request: ChatRequest) {
    if (this.runs.size) throw new Error('Es läuft bereits eine Antwort. Bitte zuerst stoppen.')
    if (!request.requestId || request.messages.length > 1000) throw new Error('Ungültige Chat-Anfrage.')
    const settings = this.store.publicSettings()
    const config = settings.providers.find(p => p.id === request.provider)
    if (!config) throw new Error('Unbekannter Anbieter.')
    const key = this.store.key(config.id)
    if (!key && config.id !== 'custom') throw new Error('Hinterlege zuerst deinen API-Key in den Einstellungen.')
    if (!request.model?.trim()) throw new Error('Bitte zuerst ein Modell wählen.')
    const project = this.store.data.projects.find(p => p.id === request.projectId)
    if (request.projectId && !project) throw new Error('Das Projekt ist nicht mehr verfügbar.')
    const policy = permissionPolicy(request.mode, request.permissions)
    const controller = new AbortController()
    const run: Run = { controller, approvals: new Map() }
    this.runs.set(request.requestId, run)
    const emit = (event: Omit<Extract<ChatEvent, { type: 'tool' }>, 'requestId'>) => this.emit({ ...event, requestId: request.requestId })
    const activity = async (name: string, input: Record<string, unknown>, execute: (progress: (output: string) => void) => Promise<string | BuildResult>, requiresApproval = false, before?: string) => {
      const id = crypto.randomUUID()
      const approval = requiresApproval && policy.needsApproval
      const item: ToolActivity = { id, name, input, status: approval ? 'approval' : 'running', before, automatic: requiresApproval && !policy.needsApproval }
      if (controller.signal.aborted) throw new Error('Abgebrochen')
      if (approval) {
        const approved = await new Promise<boolean>(resolve => {
          run.approvals.set(id, value => { run.approvals.delete(id); resolve(value) })
          emit({ type: 'tool', tool: item })
        })
        if (!approved || controller.signal.aborted) {
          emit({ type: 'tool', tool: { ...item, status: controller.signal.aborted ? 'cancelled' : 'denied', output: controller.signal.aborted ? 'Abgebrochen.' : 'Vom Nutzer abgelehnt.', finishedAt: Date.now() } })
          return 'Der Nutzer hat diese Aktion abgelehnt oder gestoppt. Nicht erneut versuchen, bis er ausdrücklich darum bittet.'
        }
      }
      const elapsed = activityClock()
      const running: ToolActivity = { ...item, status: 'running', startedAt: Date.now(), elapsedMs: 0 }
      let latestOutput: string | undefined
      emit({ type: 'tool', tool: running })
      try {
        const result = await execute(output => {
          latestOutput = output
          if (!controller.signal.aborted) emit({ type: 'tool', tool: { ...running, output, elapsedMs: elapsed() } })
        })
        const output = typeof result === 'string' ? result : result.output
        emit({ type: 'tool', tool: { ...running, status: 'done', output, artifacts: typeof result === 'string' ? undefined : result.artifacts, finishedAt: Date.now(), elapsedMs: elapsed() } })
        return typeof result === 'string' ? output : JSON.stringify({ success: true, ...result })
      } catch (error) {
        const output = error instanceof Error ? error.message : 'Aktion fehlgeschlagen.'
        emit({ type: 'tool', tool: { ...running, status: controller.signal.aborted ? 'cancelled' : 'error', output: controller.signal.aborted ? latestOutput : output, finishedAt: Date.now(), elapsedMs: elapsed() } })
        return `Fehler: ${output}`
      }
    }
    const tools = project && policy.canRead ? {
      list_files: tool({ description: 'List files and directories in the project. Use relative paths.', inputSchema: z.object({ path: z.string().describe('Relative directory, e.g. . or src') }), execute: ({ path }) => activity('list_files', { path }, async () => JSON.stringify(await listWorkspaceFiles(project.path, path))) }),
      read_file: tool({ description: 'Read a UTF-8 file in the project. Credentials are protected.', inputSchema: z.object({ path: z.string() }), execute: ({ path }) => activity('read_file', { path }, () => readWorkspaceFile(project.path, path)) }),
      inspect_build: tool({ description: 'Inspect a Java/Minecraft plugin project without executing it. Detect Maven/Gradle, wrapper versions, Java compiler and runtime versions. Use before compiling. path is relative to the selected project.', inputSchema: z.object({ path: z.string().default('.'), system: z.enum(['maven', 'gradle']).optional() }), execute: options => activity('inspect_build', options, async () => JSON.stringify(await this.builds.inspect(project.path, options))) }),
      ...(policy.canWrite ? {
        build_project: tool({ description: `Compile a Maven or Gradle Java/Minecraft project with the appropriate JDK and build tool. Missing tools are downloaded and checksum-verified in Koda's tool directory. Prefer project wrappers. Stream build output and return real JAR paths. ${policy.needsApproval ? 'Requires approval before installing tools or executing the build.' : 'Tool setup and builds are preapproved for this chat.'} Only use when the user requests compilation/building. Fix build errors using file tools, then retry; never claim a JAR exists without returned artifacts.`, inputSchema: z.object({ path: z.string().default('.'), system: z.enum(['maven', 'gradle']).optional(), javaVersion: z.number().int().min(8).max(30).optional().describe('Override only when the requested Java target cannot be detected from the project.'), runtimeJavaVersion: z.number().int().min(8).max(30).optional().describe('Use a separate JVM for build-tool/plugins requiring newer Java, preserving the compiler target. Usually detected automatically.'), task: z.string().optional().describe('Local build target, e.g. package, build, shadowJar or reobfJar. Omit for the default.') }), execute: async options => {
          const plan = await this.builds.inspect(project.path, options)
          return activity('build_project', { path: plan.path, command: plan.command, system: plan.system, buildVersion: plan.version, javaVersion: plan.javaVersion, runtimeJava: plan.runtimeJava, explanation: `Projekt kompilieren mit ${plan.system === 'maven' ? 'Maven' : 'Gradle'} ${plan.version} und Java ${plan.javaVersion}${plan.runtimeJava !== plan.javaVersion ? ` (Build-Laufzeit Java ${plan.runtimeJava})` : ''}. Fehlende Werkzeuge werden im Koda-Ordner eingerichtet.` }, onOutput => this.builds.run(project.path, plan, controller.signal, onOutput), true)
        } }),
        write_file: tool({ description: `Create or replace a project file. Read existing files first. ${policy.needsApproval ? 'The user must approve the exact change.' : 'File changes are preapproved for this chat.'}`, inputSchema: z.object({ path: z.string(), content: z.string().describe('Full new file content') }), execute: async ({ path, content }) => {
          await workspacePath(project.path, path, true)
          const before = await readWorkspaceFile(project.path, path).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error })
          return activity('write_file', { path, content }, async () => {
            const current = await readWorkspaceFile(project.path, path).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error })
            if (current !== before) throw new Error('Die Datei wurde inzwischen geändert. Bitte erneut lesen und eine neue Änderung vorschlagen.')
            await writeWorkspaceFile(project.path, path, content)
            return `Datei gespeichert: ${path}`
          }, true, before)
        } }),
        run_command: tool({ description: `Run a shell command in the project. ${policy.needsApproval ? 'Requires explicit user approval every time.' : 'Commands are preapproved for this chat.'} Do not read secrets. Prefer short, non-interactive commands.`, inputSchema: z.object({ command: z.string(), explanation: z.string().describe('Brief explanation in the user language') }), execute: ({ command, explanation }) => activity('run_command', { command, explanation }, onOutput => runCommand(command, { cwd: project.path, signal: controller.signal, onOutput }), true) }),
      } : {}),
    } : undefined
    const messages = (request.apiMessages?.length ? request.apiMessages : request.messages) as ModelMessage[]
    try {
      const result = streamText({
        model: createModel({ ...config, model: request.model }, key),
        system: `You are Koda, a precise and capable ${request.mode === 'chat' ? 'conversational assistant' : 'coding partner'} in a local desktop app. Reply in the user's language, German by default. Keep explanations clear and practical. Use Markdown. Never claim you ran commands or changed files unless tools confirm it. ${request.mode === 'chat' ? 'Help with questions, writing, ideas, analysis and everyday tasks. You are in Chat mode with no access to local file tools or shell commands. You can use files explicitly attached to the conversation. Do not ask for a project folder unless the user wants to work on local code.' : project ? `The selected project is ${project.name}. All file paths must be relative to its root. Start by inspecting relevant files. Do not access credentials or secrets. ${policy.needsApproval ? "File changes and commands require the user's approval." : 'Full access is enabled for this chat: file changes and commands are preapproved and may be executed without asking again, with the OS user permissions.'} If an action is denied, respect the decision. ${!policy.canWrite ? 'You are in read-only mode. Explain and inspect; do not change files or run commands.' : 'Implement complete, working changes. Read before editing, preserve existing work, and verify when appropriate. When the user asks to compile/package/build a Java or Minecraft plugin project, inspect_build and then build_project are the preferred tools. They select the appropriate Java runtime/compiler and provision missing tools automatically. For a new plugin, create complete Maven/Gradle build files, the appropriate Minecraft API dependency with provided/compileOnly scope, explicit Java compatibility and plugin metadata before building. Respect existing wrappers and versions. Fix build failures from the returned log and retry with the same permissions. Only report success after a successful build, and only cite JAR paths returned as artifacts. If no JAR was returned, inspect the packaging or task; never invent an artifact or silently skip the requested build. Do not execute build tools when compilation was not requested.'}` : 'No project folder is selected. You can discuss code and produce code snippets. Ask the user to open a folder when local files are needed.'}\n${settings.systemPrompt}`,
        messages,
        tools,
        stopWhen: stepCountIs(20),
        abortSignal: controller.signal,
        ...effortRequestOptions(request.provider, request.model, request.effort, config),
        maxRetries: 1,
      })
      let failure: unknown
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') this.emit({ type: 'text', requestId: request.requestId, text: part.text })
        if (part.type === 'error') failure = part.error
      }
      if (controller.signal.aborted) { this.emit({ type: 'aborted', requestId: request.requestId }); return }
      if (failure) throw failure
      const [response, usage] = await Promise.all([result.response, result.totalUsage])
      this.emit({ type: 'done', requestId: request.requestId, apiMessages: [...messages, ...response.messages], tokens: usage.totalTokens ?? 0 })
    } catch (error) {
      if (controller.signal.aborted) this.emit({ type: 'aborted', requestId: request.requestId })
      else {
        let message = error instanceof Error ? error.message : 'Die Anfrage ist fehlgeschlagen.'
        if (key) message = message.replaceAll(key, '[API-Key]')
        const capabilities = (config.id === 'custom' || config.id === 'unorouter') ? effortErrorCapabilities(message) : undefined
        if (capabilities) {
          await this.store.setModelCapabilities(config.id, request.model, capabilities)
          this.emit({ type: 'model-capabilities', requestId: request.requestId, provider: config.id, model: request.model, capabilities })
          message = `Die Modellroute hat die Effort-Stufe abgelehnt. Das Effort-Menü wurde aktualisiert. Wähle eine unterstützte Stufe und sende erneut. Unterstützt: ${capabilities.effortLevels!.join(', ')}.`
        }
        else if (/401|incorrect.*key|unauthorized|authentication/i.test(message)) message = 'Der API-Key wurde nicht akzeptiert. Bitte prüfe deine Einstellungen.'
        else if (/429|quota|rate.limit|credit|billing/i.test(message)) message = 'Dein Anbieter meldet ein Limit oder fehlendes Guthaben. Prüfe dein API-Konto und versuche es erneut.'
        else if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(message)) message = 'Der Anbieter ist nicht erreichbar. Prüfe Internetverbindung und Endpoint.'
        this.emit({ type: 'error', requestId: request.requestId, error: message.slice(0, 1200) })
      }
    } finally { this.runs.delete(request.requestId) }
  }
}
