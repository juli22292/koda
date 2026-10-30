import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effortErrorCapabilities, effortRequestOptions, effortSupport, normalizeEffort, parseModelCapabilities } from '../src/shared/effort'
import { defaultSettings } from '../src/shared/providers'
import type { ProviderConfig } from '../src/shared/types'

test('model-specific limits exclude incompatible effort levels and unknown endpoints', () => {
  assert.deepEqual(effortSupport('openai', 'gpt-6.1-sol')?.levels, ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.equal(normalizeEffort('openai', 'gpt-6.1-sol', 'none'), 'auto')
  assert.equal(normalizeEffort('openai', 'gpt-6.1-terra', 'none'), 'none')
  assert.equal(normalizeEffort('openai', 'gpt-5.2-2025-12-11', 'xhigh'), 'xhigh')
  assert.equal(normalizeEffort('openai', 'gpt-5.4-pro', 'low'), 'auto')
  assert.equal(normalizeEffort('openai', 'gpt-4.1', 'high'), 'auto')
  assert.equal(effortSupport('custom', 'gpt-6.1-sol'), undefined)
  assert.deepEqual(effortSupport('unorouter', 'gpt-6.1-sol')?.levels, ['max'])
  assert.equal(effortSupport('anthropic', 'claude-sonnet-4-5'), undefined)
  assert.equal(normalizeEffort('anthropic', 'claude-opus-4-6', 'xhigh'), 'auto')
  assert.equal(normalizeEffort('anthropic', 'claude-sonnet-5-5', 'max'), 'max')
  assert.equal(normalizeEffort('google', 'gemini-3.8-flash', 'minimal'), 'auto')
  assert.equal(normalizeEffort('google', 'gemini-3-pro-preview', 'medium'), 'auto')
  assert.equal(normalizeEffort('xai', 'grok-4.5', 'xhigh'), 'auto')
  assert.equal(normalizeEffort('xai', 'grok-4.7', 'none'), 'auto')
  assert.equal(normalizeEffort('xai', 'grok-4.7', 'xhigh'), 'xhigh')
  for (const model of ['gemini-3.8-flash-image', 'gemini-2.5-flash-native-audio', 'gemini-future']) assert.equal(effortSupport('google', model), undefined)
})

test('UnoRouter Qwen and Fable routes use their own accepted levels and valid Auto defaults', () => {
  assert.deepEqual(effortSupport('unorouter', 'qwen3.8-27b:free')?.levels, ['low', 'medium', 'xhigh'])
  assert.equal(normalizeEffort('unorouter', 'qwen3.8-27b:free', 'high'), 'auto')
  const automatic = effortRequestOptions('unorouter', 'qwen3.8-27b:free', 'auto')
  assert.equal(automatic.providerOptions?.unorouter.reasoningEffort, 'xhigh')
  assert.equal(automatic.maxOutputTokens, 32768)
  assert.equal(effortRequestOptions('unorouter', 'claude-fable-5', 'max').providerOptions?.unorouter.reasoningEffort, 'max')
  const custom = { ...defaultSettings().providers.find(item => item.id === 'custom')!, baseURL: 'https://api.unorouter.com/v1' }
  assert.equal(effortRequestOptions('custom', 'qwen3.8-27b:free', 'medium', custom).providerOptions?.custom.reasoningEffort, 'medium')
})

test('catalog capabilities and provider validation errors constrain routed models without inventing levels', () => {
  const config: ProviderConfig = { ...defaultSettings().providers.find(item => item.id === 'unorouter')!, modelCapabilities: { unusual: { effortLevels: ['low', 'xhigh'], maxOutputTokens: 2048 } } }
  assert.equal(normalizeEffort('unorouter', 'unusual', 'high', config), 'auto')
  assert.equal(effortRequestOptions('unorouter', 'unusual', 'xhigh', config).maxOutputTokens, 2048)
  assert.deepEqual(parseModelCapabilities({ metadata: { reasoningEfforts: ['low', 'xhigh', 'invented'], maxOutputTokens: 4096 } }), { effortLevels: ['low', 'xhigh'], maxOutputTokens: 4096 })
  assert.deepEqual(parseModelCapabilities({ supported_parameters: ['reasoning_effort'] }), undefined)
  assert.deepEqual(effortErrorCapabilities('Unexpected reasoning effort high. Supported types are xhigh (default), medium, and low. (request id: 123)'), { effortLevels: ['low', 'medium', 'xhigh'], defaultEffort: 'xhigh' })
  assert.equal(effortErrorCapabilities('Quota exceeded: billing limit'), undefined)
})
test('Auto and invalid selections do not add unsupported provider parameters', () => {
  assert.deepEqual(effortRequestOptions('openai', 'gpt-6.1-sol', 'auto'), { maxOutputTokens: 16384 })
  assert.deepEqual(effortRequestOptions('google', 'gemini-3.8-flash', 'max'), { maxOutputTokens: 16384 })
  assert.deepEqual(effortRequestOptions('custom', 'anything', 'max'), { maxOutputTokens: 16384 })
})
test('adaptive Claude thinking and Gemini budgets have valid output headroom', () => {
  const claude = effortRequestOptions('anthropic', 'claude-sonnet-5-5', 'max')
  assert.deepEqual(claude.providerOptions?.anthropic, { effort: 'max', thinking: { type: 'adaptive' } })
  assert.equal(claude.maxOutputTokens, 64000)
  const pro = effortRequestOptions('google', 'gemini-2.5-pro', 'high')
  assert.equal(pro.providerOptions?.google.thinkingConfig.thinkingBudget, 24576)
  assert.ok(pro.maxOutputTokens > pro.providerOptions!.google.thinkingConfig.thinkingBudget)
  assert.equal(normalizeEffort('google', 'gemini-2.5-pro', 'none'), 'auto')
  assert.equal(effortRequestOptions('google', 'gemini-2.5-flash', 'none').providerOptions?.google.thinkingConfig.thinkingBudget, 0)
})
