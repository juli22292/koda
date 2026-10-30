import type { ProviderConfig, ProviderId, Settings } from './types'

export const PROVIDERS: { id: ProviderId; name: string; company: string; letter: string; color: string; model: string; baseURL: string; keyURL: string }[] = [
  { id: 'openai', name: 'OpenAI', company: 'GPT & Reasoning', letter: 'O', color: '#447568', model: 'gpt-6.1-sol', baseURL: 'https://api.openai.com/v1', keyURL: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Claude', company: 'Anthropic', letter: 'A', color: '#bb755a', model: 'claude-sonnet-5-5', baseURL: 'https://api.anthropic.com/v1', keyURL: 'https://console.anthropic.com/settings/keys' },
  { id: 'google', name: 'Gemini', company: 'Google', letter: 'G', color: '#6080b3', model: 'gemini-3.8-flash', baseURL: 'https://generativelanguage.googleapis.com/v1beta', keyURL: 'https://aistudio.google.com/api-keys' },
  { id: 'xai', name: 'Grok', company: 'xAI', letter: 'x', color: '#62615d', model: 'grok-4.7', baseURL: 'https://api.x.ai/v1', keyURL: 'https://console.x.ai' },
  { id: 'custom', name: 'Eigener Anbieter', company: 'OpenAI-kompatibel · z. B. Ollama', letter: '/', color: '#8a759a', model: '', baseURL: 'http://localhost:11434/v1', keyURL: '' },
]
export const defaultSettings = (): Settings => ({
  providers: PROVIDERS.map(p => ({ id: p.id, model: p.model, baseURL: p.baseURL, hasKey: false, models: [] })),
  defaultProvider: 'openai', theme: 'dark', systemPrompt: '', fontSize: 14,
})
export const providerMeta = (id: ProviderId) => PROVIDERS.find(p => p.id === id)!
export function modelLabel(model: string) {
  const names: Record<string, string> = {
    'gpt-6.1-sol': 'GPT-6.1 Sol', 'claude-sonnet-5-5': 'Claude Sonnet 5.5',
    'gemini-3.8-flash': 'Gemini 3.8 Flash', 'grok-4.7': 'Grok 4.7',
  }
  return names[model] || model || 'Modell wählen'
}
export const isConfigured = (p: ProviderConfig) => p.hasKey || (p.id === 'custom' && !!p.model)
