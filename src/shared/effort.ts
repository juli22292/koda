import type { ModelCapabilities, ProviderConfig, ProviderId, ReasoningEffort, Settings } from './types'

type Level = Exclude<ReasoningEffort, 'auto'>
interface Support extends ModelCapabilities { levels: Level[]; mode: 'openai' | 'anthropic' | 'anthropic-adaptive' | 'google-level' | 'google-budget' | 'xai' | 'compatible' }
const standard: Level[] = ['low', 'medium', 'high']
const extended: Level[] = [...standard, 'xhigh']
const maximum: Level[] = [...extended, 'max']
export const effortLabels: Record<ReasoningEffort, string> = { auto: 'Auto', none: 'Ohne', minimal: 'Minimal', low: 'Niedrig', medium: 'Mittel', high: 'Hoch', xhigh: 'Sehr hoch', max: 'Maximum' }
export const effortKey = (provider: ProviderId, model: string) => `${provider}:${model}`
export function isUnoRouter(provider: ProviderId, config?: Pick<ProviderConfig, 'baseURL'>): boolean {
  if (provider === 'unorouter') return true
  try { const url = new URL(config?.baseURL || ''); return provider === 'custom' && url.origin === 'https://api.unorouter.com' && url.pathname.replace(/\/+$/, '') === '/v1' } catch { return false }
}
const allLevels: Level[] = ['none', 'minimal', ...maximum]
export function parseModelCapabilities(value: unknown): ModelCapabilities | undefined {
  if (!value || typeof value !== 'object') return undefined
  const data = value as Record<string, unknown>
  const meta = data.metadata && typeof data.metadata === 'object' ? data.metadata as Record<string, unknown> : {}
  const top = data.top_provider && typeof data.top_provider === 'object' ? data.top_provider as Record<string, unknown> : {}
  const raw = data.effortLevels ?? data.reasoning_efforts ?? data.supported_reasoning_efforts ?? data.reasoningEfforts ?? meta.reasoningEfforts
  const levels = Array.isArray(raw) ? allLevels.filter(level => raw.includes(level)) : undefined
  const defaultEffort = data.defaultEffort ?? data.default_reasoning_effort ?? meta.defaultReasoningEffort
  const limit = data.maxOutputTokens ?? top.max_completion_tokens ?? meta.maxOutputTokens
  const maxOutputTokens = typeof limit === 'number' && Number.isInteger(limit) && limit > 0 && limit <= 2_000_000 ? limit : undefined
  if (!levels && !maxOutputTokens) return undefined
  return { ...(levels ? { effortLevels: levels } : {}), ...(typeof defaultEffort === 'string' && levels?.includes(defaultEffort as Level) ? { defaultEffort: defaultEffort as Level } : {}), ...(maxOutputTokens ? { maxOutputTokens } : {}) }
}
export function effortErrorCapabilities(message: string): ModelCapabilities | undefined {
  if (!/reasoning[ _-]?effort/i.test(message)) return undefined
  const list = message.match(/supported\s+(?:types|values|levels|efforts)(?:\s+are|\s*:|\s*=)\s*([^\n.!]{1,250})/i)?.[1]
  if (!list) return undefined
  const levels = allLevels.filter(level => new RegExp(`\\b${level}\\b`).test(list))
  const defaultEffort = list.match(/\b(none|minimal|low|medium|high|xhigh|max)\s*\(default\)/i)?.[1] as Level | undefined
  return levels.length ? { effortLevels: levels, ...(defaultEffort ? { defaultEffort } : {}) } : undefined
}

// Verified against official provider documentation on 2026-10-30. Deliberately
// match known text-model families, not every model sharing a broad prefix.
// Model-list APIs and arbitrary compatible endpoints do not prove capability.
export function effortSupport(provider: ProviderId, model: string, config?: ProviderConfig): Support | undefined {
  const id = model.trim().toLowerCase().replace(/^models\//, '').replace(/-\d{4}-\d{2}-\d{2}$/, '')
  if (provider === 'unorouter' || provider === 'custom') {
    const discovered = parseModelCapabilities(config?.modelCapabilities?.[model])
    if (discovered?.effortLevels) {
      const levels = discovered.effortLevels
      const qwen = isUnoRouter(provider, config) && /^(?:(?:alibaba|qwen)\/)?qwen3\.8-27b(?::free)?$/.test(id)
      const defaultEffort = discovered.defaultEffort ?? (qwen && levels.includes('xhigh') ? 'xhigh' : levels.length === 1 ? levels[0] : undefined)
      return levels.length ? { ...discovered, defaultEffort, levels, mode: 'compatible' } : undefined
    }
    if (!isUnoRouter(provider, config)) return undefined
    // Router routes can differ from the native vendor API. These fallbacks
    // use UnoRouter's catalog and the concrete validation error from Qwen.
    const route = id.replace(/^(?:alibaba|qwen|anthropic|openai|deepseek)\//, '').replace(/:free$/, '')
    if (route === 'qwen3.8-27b') return { levels: ['low', 'medium', 'xhigh'], defaultEffort: 'xhigh', maxOutputTokens: 32768, mode: 'compatible' }
    if (['claude-fable-5', 'gpt-6.1-sol'].includes(route)) return { levels: ['max'], defaultEffort: 'max', maxOutputTokens: 128000, mode: 'compatible' }
    if (['gpt-oss-20b', 'gpt-oss-120b'].includes(route)) return { levels: [...standard], mode: 'compatible' }
    if (['deepseek-v4-flash', 'deepseek-v4-pro'].includes(route)) return { levels: ['high', 'xhigh'], mode: 'compatible' }
    return undefined
  }
  if (provider === 'openai') {
    let levels: Level[] | undefined
    if (['gpt-6-astra', 'gpt-6.1-sol'].includes(id)) levels = maximum
    else if (['gpt-6.1-terra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'].includes(id)) levels = ['none', ...maximum]
    else if (['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.2'].includes(id)) levels = ['none', ...extended]
    else if (['gpt-5.5-pro', 'gpt-5.4-pro', 'gpt-5.2-pro'].includes(id)) levels = ['medium', 'high', 'xhigh']
    else if (id === 'gpt-5.1') levels = ['none', ...standard]
    else if (['gpt-5', 'gpt-5-mini', 'gpt-5-nano'].includes(id)) levels = ['minimal', ...standard]
    else if (['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-max'].includes(id)) levels = extended
    else if (['gpt-5-codex', 'gpt-5.1-codex', 'o1', 'o3', 'o3-mini', 'o4-mini'].includes(id)) levels = standard
    if (levels) return { levels: [...levels], mode: 'openai' }
  }
  if (provider === 'anthropic') {
    const family = id.replaceAll('.', '-').replace(/-\d{8}$/, '')
    if (family === 'claude-opus-4-5') return { levels: [...standard], mode: 'anthropic' }
    if (['claude-opus-4-6', 'claude-sonnet-4-6'].includes(family)) return { levels: [...standard, 'max'], mode: 'anthropic-adaptive' }
    if (['claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5', 'claude-fable-5-1', 'claude-mythos-5', 'claude-mythos-5-1', 'claude-mythos-preview'].includes(family)) return { levels: [...maximum], mode: 'anthropic-adaptive' }
  }
  if (provider === 'google') {
    if (['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.1-pro-preview'].includes(id)) return { levels: [...standard], mode: 'google-level' }
    if (['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview', 'gemini-robotics-er-2-preview'].includes(id)) return { levels: ['minimal', ...standard], mode: 'google-level' }
    if (id === 'gemini-3-pro-preview') return { levels: ['low', 'high'], mode: 'google-level' }
    if (/^gemini-2\.5-(?:pro|flash(?:-lite)?)(?:-preview(?:-\d{2}-\d{2})?)?$/.test(id)) return { levels: id.includes('-pro') ? [...standard] : ['none', ...standard], mode: 'google-budget' }
  }
  if (provider === 'xai') {
    if (['grok-4.7', 'grok-4.6'].includes(id)) return { levels: [...extended], mode: 'xai' }
    if (id === 'grok-4.5') return { levels: [...standard], mode: 'xai' }
    if (id === 'grok-4.3') return { levels: ['none', ...standard], mode: 'xai' }
  }
  return undefined
}
export function normalizeEffort(provider: ProviderId, model: string, value: unknown, config?: ProviderConfig): ReasoningEffort {
  return typeof value === 'string' && effortSupport(provider, model, config)?.levels.includes(value as Level) ? value as Level : 'auto'
}
export function normalizeSettingsEffort(settings: Settings, provider: ProviderId, model: string, value: unknown): ReasoningEffort {
  return normalizeEffort(provider, model, value, settings.providers.find(item => item.id === provider))
}
export function effortRequestOptions(provider: ProviderId, model: string, value: unknown, config?: ProviderConfig): { maxOutputTokens: number; providerOptions?: Record<string, Record<string, any>> } {
  const support = effortSupport(provider, model, config)
  const selected = normalizeEffort(provider, model, value, config)
  const effort = selected === 'auto' ? support?.defaultEffort : selected
  const limit = Math.min(support?.maxOutputTokens ?? Infinity, parseModelCapabilities(config?.modelCapabilities?.[model])?.maxOutputTokens ?? Infinity)
  if (!effort || !support) return { maxOutputTokens: Math.min(16384, limit) }
  const maxOutputTokens = Math.min(limit, effort === 'max' || effort === 'xhigh' ? 64000 : effort === 'medium' || effort === 'high' ? 32768 : 16384)
  switch (support.mode) {
    case 'compatible': return { maxOutputTokens, providerOptions: { [provider]: { reasoningEffort: effort } } }
    case 'openai': return { maxOutputTokens, providerOptions: { openai: { reasoningEffort: effort } } }
    case 'xai': return { maxOutputTokens, providerOptions: { xai: { reasoningEffort: effort } } }
    case 'anthropic': return { maxOutputTokens, providerOptions: { anthropic: { effort } } }
    case 'anthropic-adaptive': return { maxOutputTokens, providerOptions: { anthropic: { effort, thinking: { type: 'adaptive' } } } }
    case 'google-level': return { maxOutputTokens, providerOptions: { google: { thinkingConfig: { thinkingLevel: effort } } } }
    case 'google-budget': {
      const budget = effort === 'none' ? 0 : effort === 'low' ? 1024 : effort === 'medium' ? 8192 : 24576
      return { maxOutputTokens: Math.max(16384, budget + 8192), providerOptions: { google: { thinkingConfig: { thinkingBudget: budget } } } }
    }
  }
}
