import { test } from 'node:test'
import assert from 'node:assert/strict'
import { greetingForHour } from '../src/shared/greeting'

test('short greetings cover every hour and change at the local time boundaries', () => {
  assert.equal(greetingForHour(4), 'Hallo, Nachteule')
  assert.equal(greetingForHour(5), 'Guten Morgen')
  assert.equal(greetingForHour(10), 'Guten Morgen')
  assert.equal(greetingForHour(11), 'Hallo, wie läuft’s?')
  assert.equal(greetingForHour(14), 'Zeit für neue Ideen?')
  assert.equal(greetingForHour(18), 'Guten Abend')
  assert.equal(greetingForHour(22), 'Hallo, Nachteule')
  for (let hour = 0; hour < 24; hour++) assert.ok(greetingForHour(hour).length < 25)
})
