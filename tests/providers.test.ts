import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { generateText } from 'ai'
import { createModel, fetchModels } from '../src/main/agent'
import { defaultSettings } from '../src/shared/providers'
import { effortRequestOptions } from '../src/shared/effort'
import type { ProviderConfig, ProviderId } from '../src/shared/types'

let origin: string
const requests: { url: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }[] = []
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = raw ? JSON.parse(raw) : {}
  requests.push({ url: req.url!, headers: req.headers, body })
  const id = req.url!.split('/')[1]
  res.writeHead(200, { 'Content-Type': 'application/json' })
  if (req.method === 'GET') {
    res.end(JSON.stringify(id === 'google' ? { models: [{ name: 'models/gemini-test', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding-test', supportedGenerationMethods: ['embedContent'] }] } : { data: [{ id: 'test-model' }] }))
  } else if (id === 'anthropic') {
    res.end(JSON.stringify({ id: 'msg-test', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: 'Hallo vom Adapter.' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 3, output_tokens: 4 } }))
  } else if (id === 'google') {
    res.end(JSON.stringify({ responseId: 'google-test', candidates: [{ content: { role: 'model', parts: [{ text: 'Hallo vom Adapter.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 } }))
  } else if (id === 'custom' || id === 'unorouter') {
    res.end(JSON.stringify({ id: 'chat-test', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: 'Hallo vom Adapter.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }))
  } else {
    res.end(JSON.stringify({ id: 'resp-test', object: 'response', created_at: 1, status: 'completed', model: body.model, output: [{ type: 'message', id: 'message-test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Hallo vom Adapter.', annotations: [] }] }], usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } }))
  }
})
before(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
after(() => { server.closeAllConnections(); server.close() })
const config = (id: ProviderId): ProviderConfig => ({ ...defaultSettings().providers.find(p => p.id === id)!, baseURL: `${origin}/${id}`, model: 'test-model' })
for (const id of ['openai', 'anthropic', 'google', 'xai', 'custom', 'unorouter'] as ProviderId[]) {
  test(`${id}: SDK adapter uses native request format and parses response`, async () => {
    const result = await generateText({ model: createModel(config(id), 'test-secret'), prompt: 'Hallo', maxOutputTokens: 256, maxRetries: 0 })
    assert.equal(result.text, 'Hallo vom Adapter.')
    const request = requests.at(-1)!
    if (id === 'openai' || id === 'xai') { assert.equal(request.url, `/${id}/responses`); assert.ok(Array.isArray(request.body.input)) }
    if (id === 'anthropic') { assert.equal(request.url, '/anthropic/messages'); assert.equal(request.headers['x-api-key'], 'test-secret') }
    if (id === 'google') { assert.match(request.url, /google\/models\/test-model:generateContent/); assert.equal(request.headers['x-goog-api-key'], 'test-secret') }
    if (id === 'custom') assert.equal(request.url, '/custom/chat/completions')
    if (id === 'unorouter') assert.equal(request.url, '/unorouter/chat/completions')
    if (id === 'openai' || id === 'xai' || id === 'custom' || id === 'unorouter') assert.equal(request.headers.authorization, 'Bearer test-secret')
  })
  test(`${id}: model discovery uses correct authentication`, async () => {
    const models = await fetchModels(config(id), 'test-secret')
    assert.deepEqual(models, id === 'google' ? ['gemini-test'] : ['test-model'])
    const request = requests.at(-1)!
    if (id === 'google') { assert.equal(request.headers['x-goog-api-key'], 'test-secret'); assert.ok(!request.url.includes('test-secret')) }
    else if (id === 'anthropic') assert.equal(request.headers['anthropic-version'], '2023-06-01')
    else assert.equal(request.headers.authorization, 'Bearer test-secret')
  })
}

test('effort settings reach the native SDK request bodies for all four providers', async () => {
  for (const sample of [
    { id: 'openai', model: 'gpt-6.1-sol', effort: 'max' },
    { id: 'anthropic', model: 'claude-sonnet-5-5', effort: 'max' },
    { id: 'google', model: 'gemini-3.8-flash', effort: 'high' },
    { id: 'google', model: 'gemini-2.5-pro', effort: 'high' },
    { id: 'xai', model: 'grok-4.7', effort: 'xhigh' },
  ] as const) {
    const selected = { ...config(sample.id), model: sample.model }
    const options = effortRequestOptions(sample.id, sample.model, sample.effort)
    const result = await generateText({ model: createModel(selected, 'test-secret'), prompt: 'Hallo', ...options, maxRetries: 0 })
    assert.equal(result.text, 'Hallo vom Adapter.')
    const body = requests.at(-1)!.body as any
    if (sample.id === 'openai' || sample.id === 'xai') assert.equal(body.reasoning.effort, sample.effort)
    if (sample.id === 'anthropic') { assert.equal(body.output_config.effort, 'max'); assert.equal(body.thinking.type, 'adaptive'); assert.equal(body.max_tokens, 64000) }
    if (sample.model === 'gemini-3.8-flash') { assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'high'); assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, undefined) }
    if (sample.model === 'gemini-2.5-pro') assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 24576)
  }
})
