import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activityClock, formatElapsed, restoreInterruptedActivities, validElapsed } from '../src/shared/activity-time'
import type { AppData } from '../src/shared/types'

test('execution time follows the monotonic clock rather than wall-clock jumps', t => {
  let monotonic = 1000
  const elapsed = activityClock(() => monotonic)
  t.mock.method(Date, 'now', () => 1_000_000)
  monotonic += 1250
  assert.equal(elapsed(), 1250)
  t.mock.method(Date, 'now', () => 1_000_000 + 3_600_000)
  monotonic += 1250
  assert.equal(elapsed(), 2500)
  assert.equal(formatElapsed(elapsed()), '2,5 s')
})
test('long actual durations use minutes/hours; invalid durations do not leak NaN', () => {
  assert.equal(formatElapsed(1000_000), '16 min 40 s')
  assert.equal(formatElapsed(3600_000), '1 h')
  assert.equal(formatElapsed(3720_000), '1 h 2 min')
  assert.equal(validElapsed(NaN), false)
  assert.equal(validElapsed(-1), false)
  assert.equal(formatElapsed(Infinity), '0,0 s')
})
test('restoring old interrupted tools stops phantom counters without touching completed durations', () => {
  const data: AppData = { projects: [], conversations: [{ id: 'chat', title: 'Test', provider: 'google', model: 'gemini-3.8-flash', mode: 'code', updatedAt: 1000, messages: [{ id: 'answer', role: 'assistant', content: '', createdAt: 1000, tools: [
    { id: 'old', name: 'build_project', input: {}, status: 'running', startedAt: 1000 },
    { id: 'done', name: 'read_file', input: {}, status: 'done', elapsedMs: 250 },
  ] }] }] }
  const restored = restoreInterruptedActivities(data)
  assert.equal(restored.conversations[0].messages[0].tools![0].status, 'cancelled')
  assert.equal(restored.conversations[0].messages[0].interrupted, true)
  assert.equal(restored.conversations[0].messages[0].tools![1].elapsedMs, 250)
  assert.equal(data.conversations[0].messages[0].tools![0].status, 'running')
})
