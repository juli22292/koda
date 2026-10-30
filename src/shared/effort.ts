import type { ProviderId, ReasoningEffort } from './types'

type Level = Exclude<ReasoningEffort, 'auto'>
interface Support { levels: Level[]; mode: 'openai' | 'anthropic' | 'anthropic-adaptive' | 'google-level' | 'google-budget' | 'xai' }
const standard: Level[] = ['low', 'medium', 'high']
const extended: Level[] = [...standard, 'xhigh']
const maximum: Level[] = [...extended, 'max']
export const effortLabels: Record<ReasoningEffort, string> = { auto: 'Auto', none: 'Ohne', minimal: 'Minimal', low: 'Niedrig', medium: 'Mittel', high: 'Hoch', xhigh: 'Sehr hoch', max: 'Maximum' }
export const effortKey = (provider: ProviderId, model: string) => `${provider}:${model}`

// Verified against official provider documentation on 2026-10-30. Deliberately
// match known text-model families, not every model sharing a broad prefix.
// Model-list APIs and arbitrary compatible endpoints do not prove capability.
export function effortSupport(provider: ProviderId, model: string): Support | undefined {
  const id = model.trim().toLowerCase().replace(/^models\//, '').replace(/-\d{4}-\d{2}-\d{2}$/, '')
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
export function normalizeEffort(provider: ProviderId, model: string, value: unknown): ReasoningEffort {
  return typeof value === 'string' && effortSupport(provider, model)?.levels.includes(value as Level) ? value as Level : 'auto'
}
export function effortRequestOptions(provider: ProviderId, model: string, value: unknown): { maxOutputTokens: number; providerOptions?: Record<string, Record<string, any>> } {
  const effort = normalizeEffort(provider, model, value)
  if (effort === 'auto') return { maxOutputTokens: 16384 }
  const support = effortSupport(provider, model)!
  const maxOutputTokens = effort === 'max' || effort === 'xhigh' ? 64000 : effort === 'medium' || effort === 'high' ? 32768 : 16384
  switch (support.mode) {
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
