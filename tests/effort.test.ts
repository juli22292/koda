import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effortRequestOptions, effortSupport, normalizeEffort } from '../src/shared/effort'

test('model-specific limits exclude incompatible effort levels and unknown endpoints', () => {
  assert.deepEqual(effortSupport('openai', 'gpt-6.1-sol')?.levels, ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.equal(normalizeEffort('openai', 'gpt-6.1-sol', 'none'), 'auto')
  assert.equal(normalizeEffort('openai', 'gpt-6.1-terra', 'none'), 'none')
  assert.equal(normalizeEffort('openai', 'gpt-5.2-2025-12-11', 'xhigh'), 'xhigh')
  assert.equal(normalizeEffort('openai', 'gpt-5.4-pro', 'low'), 'auto')
  assert.equal(normalizeEffort('openai', 'gpt-4.1', 'high'), 'auto')
  assert.equal(effortSupport('custom', 'gpt-6.1-sol'), undefined)
  assert.equal(effortSupport('unorouter', 'gpt-6.1-sol'), undefined)
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
