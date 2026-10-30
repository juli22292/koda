export type ProviderId = 'openai' | 'anthropic' | 'google' | 'xai' | 'custom'
export type Mode = 'chat' | 'code' | 'ask'
export type PermissionMode = 'read-only' | 'ask' | 'full-access'
export type ReasoningEffort = 'auto' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Theme = 'light' | 'dark' | 'system'
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error' | 'unsupported'
export interface AppUpdateState {
  status: UpdateStatus
  currentVersion: string
  version?: string
  percent?: number
  error?: string
}
export interface ProviderConfig {
  id: ProviderId
  model: string
  baseURL: string
  hasKey: boolean
  models: string[]
}
export interface Settings {
  providers: ProviderConfig[]
  defaultProvider: ProviderId
  theme: Theme
  systemPrompt: string
  fontSize: number
  effortPreferences?: Record<string, ReasoningEffort>
}
export interface Project { id: string; name: string; path: string; lastOpened: number }
export interface Attachment { name: string; content: string; path?: string }
export interface BuildArtifact { name: string; path: string; size: number; kind: 'plugin' | 'jar' }
export interface BuildResult { output: string; artifacts: BuildArtifact[] }
export interface ToolActivity {
  id: string
  name: string
  input: Record<string, unknown>
  status: 'running' | 'approval' | 'done' | 'error' | 'denied' | 'cancelled'
  output?: string
  before?: string
  startedAt?: number
  finishedAt?: number
  elapsedMs?: number
  automatic?: boolean
  artifacts?: BuildArtifact[]
}
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  attachments?: Attachment[]
  tools?: ToolActivity[]
  model?: string
  error?: string
  interrupted?: boolean
}
export interface Conversation {
  id: string
  title: string
  projectId?: string
  provider: ProviderId
  model: string
  mode: Mode
  permissions?: PermissionMode
  effort?: ReasoningEffort
  messages: Message[]
  apiMessages?: unknown[]
  updatedAt: number
  tokens?: number
}
export interface AppData { projects: Project[]; conversations: Conversation[] }
export interface FileEntry { name: string; path: string; directory: boolean }
export interface ChatRequest {
  requestId: string
  conversationId: string
  provider: ProviderId
  model: string
  mode: Mode
  permissions?: PermissionMode
  effort?: ReasoningEffort
  projectId?: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  apiMessages?: unknown[]
}
export type ChatEvent =
  | { type: 'text'; requestId: string; text: string }
  | { type: 'tool'; requestId: string; tool: ToolActivity }
  | { type: 'done'; requestId: string; apiMessages: unknown[]; tokens: number }
  | { type: 'error'; requestId: string; error: string }
  | { type: 'aborted'; requestId: string }
export interface KodaBridge {
  desktop: boolean
  getUpdateState(): Promise<AppUpdateState>
  checkForUpdates(): Promise<AppUpdateState>
  downloadUpdate(): Promise<AppUpdateState>
  installUpdate(): Promise<void>
  onUpdateState(callback: (state: AppUpdateState) => void): () => void
  getSettings(): Promise<Settings>
  saveSettings(settings: Partial<Omit<Settings, 'providers'>>): Promise<Settings>
  saveProvider(provider: ProviderId, config: { model: string; baseURL: string; apiKey?: string }): Promise<ProviderConfig>
  removeKey(provider: ProviderId): Promise<ProviderConfig>
  testProvider(provider: ProviderId): Promise<{ models: string[] }>
  getData(): Promise<AppData>
  saveData(data: AppData): Promise<void>
  openProject(): Promise<Project | null>
  listFiles(projectId: string, relativePath?: string): Promise<FileEntry[]>
  readFile(projectId: string, relativePath: string): Promise<string>
  revealArtifact(projectId: string, relativePath: string): Promise<void>
  pickFiles(): Promise<Attachment[]>
  startChat(request: ChatRequest): Promise<void>
  stopChat(requestId: string): Promise<void>
  approveTool(requestId: string, toolId: string, approved: boolean): Promise<void>
  onChatEvent(callback: (event: ChatEvent) => void): () => void
  windowAction(action: 'minimize' | 'maximize' | 'close'): void
  openExternal(url: string): Promise<void>
  exportChat(title: string, markdown: string): Promise<boolean>
}
declare global { interface Window { koda?: KodaBridge } }
