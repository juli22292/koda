import { streamText, stepCountIs, tool, type ModelMessage, type LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createXai } from '@ai-sdk/xai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'
import { runCommand } from './commands'
import { permissionPolicy } from '../shared/permissions'
import type { ChatEvent, ChatRequest, ToolActivity, ProviderConfig } from '../shared/types'
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
  }
}
export async function fetchModels(config: ProviderConfig, key: string): Promise<string[]> {
  if (!key && config.id !== 'custom') throw new Error('Bitte zuerst einen API-Key speichern.')
  const url = `${config.baseURL}/models${config.id === 'google' ? '?pageSize=1000' : ''}`
  const headers: Record<string, string> = config.id === 'anthropic'
    ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    : config.id === 'google' ? { 'x-goog-api-key': key } : key ? { Authorization: `Bearer ${key}` } : {}
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' })
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Der API-Key wurde nicht akzeptiert. Prüfe Key und Berechtigungen.' : `Der Anbieter antwortet mit HTTP ${response.status}.`)
  const body = await response.json() as { data?: { id: string }[]; models?: { name: string; supportedGenerationMethods?: string[] }[] }
  return (config.id === 'google'
    ? body.models?.filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent')).map(m => m.name.replace(/^models\//, ''))
    : body.data?.map(m => m.id))?.filter(id => typeof id === 'string').sort() ?? []
}
interface Run { controller: AbortController; approvals: Map<string, (approved: boolean) => void> }
export class Agent {
  private runs = new Map<string, Run>()
  get isRunning() { return this.runs.size > 0 }
  constructor(private store: Store, private emit: (event: ChatEvent) => void) {}
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
    const activity = async (name: string, input: Record<string, unknown>, execute: (progress: (output: string) => void) => Promise<string>, requiresApproval = false, before?: string) => {
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
      const running: ToolActivity = { ...item, status: 'running', startedAt: Date.now() }
      let latestOutput: string | undefined
      emit({ type: 'tool', tool: running })
      try {
        const output = await execute(output => {
          latestOutput = output
          if (!controller.signal.aborted) emit({ type: 'tool', tool: { ...running, output } })
        })
        emit({ type: 'tool', tool: { ...running, status: 'done', output, finishedAt: Date.now() } })
        return output
      } catch (error) {
        const output = error instanceof Error ? error.message : 'Aktion fehlgeschlagen.'
        emit({ type: 'tool', tool: { ...running, status: controller.signal.aborted ? 'cancelled' : 'error', output: controller.signal.aborted ? latestOutput : output, finishedAt: Date.now() } })
        return `Fehler: ${output}`
      }
    }
    const tools = project && policy.canRead ? {
      list_files: tool({ description: 'List files and directories in the project. Use relative paths.', inputSchema: z.object({ path: z.string().describe('Relative directory, e.g. . or src') }), execute: ({ path }) => activity('list_files', { path }, async () => JSON.stringify(await listWorkspaceFiles(project.path, path))) }),
      read_file: tool({ description: 'Read a UTF-8 file in the project. Credentials are protected.', inputSchema: z.object({ path: z.string() }), execute: ({ path }) => activity('read_file', { path }, () => readWorkspaceFile(project.path, path)) }),
      ...(policy.canWrite ? {
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
        system: `You are Koda, a precise and capable ${request.mode === 'chat' ? 'conversational assistant' : 'coding partner'} in a local desktop app. Reply in the user's language, German by default. Keep explanations clear and practical. Use Markdown. Never claim you ran commands or changed files unless tools confirm it. ${request.mode === 'chat' ? 'Help with questions, writing, ideas, analysis and everyday tasks. You are in Chat mode with no access to local file tools or shell commands. You can use files explicitly attached to the conversation. Do not ask for a project folder unless the user wants to work on local code.' : project ? `The selected project is ${project.name}. All file paths must be relative to its root. Start by inspecting relevant files. Do not access credentials or secrets. ${policy.needsApproval ? "File changes and commands require the user's approval." : 'Full access is enabled for this chat: file changes and commands are preapproved and may be executed without asking again, with the OS user permissions.'} If an action is denied, respect the decision. ${!policy.canWrite ? 'You are in read-only mode. Explain and inspect; do not change files or run commands.' : 'Implement complete, working changes. Read before editing, preserve existing work, and verify when appropriate.'}` : 'No project folder is selected. You can discuss code and produce code snippets. Ask the user to open a folder when local files are needed.'}\n${settings.systemPrompt}`,
        messages,
        tools,
        stopWhen: stepCountIs(20),
        abortSignal: controller.signal,
        maxOutputTokens: 16384,
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
        if (/401|incorrect.*key|unauthorized|authentication/i.test(message)) message = 'Der API-Key wurde nicht akzeptiert. Bitte prüfe deine Einstellungen.'
        else if (/429|quota|rate.limit|credit|billing/i.test(message)) message = 'Dein Anbieter meldet ein Limit oder fehlendes Guthaben. Prüfe dein API-Konto und versuche es erneut.'
        else if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(message)) message = 'Der Anbieter ist nicht erreichbar. Prüfe Internetverbindung und Endpoint.'
        this.emit({ type: 'error', requestId: request.requestId, error: message.slice(0, 1200) })
      }
    } finally { this.runs.delete(request.requestId) }
  }
}
