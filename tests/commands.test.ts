import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runCommand } from '../src/main/commands'

const windows = process.platform === 'win32'
const cwd = process.cwd()

test('terminal output arrives before completion and includes stderr', async () => {
  let finished = false, sawLiveOutput = false
  const command = windows ? "Write-Output 'live-start Grüße'; Start-Sleep -Milliseconds 350; [Console]::Error.WriteLine('live-stderr'); Write-Output 'live-end'" : "printf 'live-start Grüße\n'; sleep 0.35; printf 'live-stderr\n' >&2; printf 'live-end\n'"
  const output = await runCommand(command, { cwd, signal: new AbortController().signal, onOutput: value => {
    if (value.includes('live-start') && !value.includes('live-end') && !finished) sawLiveOutput = true
  } })
  finished = true
  assert.equal(sawLiveOutput, true)
  assert.match(output, /live-stderr/)
  assert.match(output, /live-end/)
  assert.match(output, /Grüße/)
})
test('failed commands preserve their output and exit code', async () => {
  await assert.rejects(runCommand(windows ? "Write-Output 'failed-detail'; exit 7" : "echo failed-detail; exit 7", { cwd, signal: new AbortController().signal, onOutput: () => {} }), /Exit: 7\nfailed-detail/)
})
test('stopping an executing command aborts it promptly and keeps its live output', async () => {
  const controller = new AbortController()
  let output = ''
  const command = windows ? "Write-Output 'cancel-start'; Start-Sleep -Seconds 20; Write-Output 'should-not-appear'" : "echo cancel-start; sleep 20; echo should-not-appear"
  const started = Date.now()
  await assert.rejects(runCommand(command, { cwd, signal: controller.signal, onOutput: value => { output = value; if (value.includes('cancel-start')) controller.abort() } }), /abgebrochen/)
  assert.match(output, /cancel-start/)
  assert.doesNotMatch(output, /should-not-appear/)
  assert.ok(Date.now() - started < 10_000)
})
test('a command timeout stops the process and does not report success', async () => {
  await assert.rejects(runCommand(windows ? 'Start-Sleep -Seconds 20' : 'sleep 20', { cwd, signal: new AbortController().signal, onOutput: () => {}, timeoutMs: 300 }), /Zeitlimit/)
})
