import { execFile, spawn } from 'node:child_process'

interface CommandOptions {
  cwd: string
  signal: AbortSignal
  onOutput(output: string): void
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

// Stream a bounded tail of both output channels. The whole process tree is
// stopped on cancellation so commands spawned by PowerShell do not keep running.
export function runCommand(command: string, { cwd, signal, onOutput, timeoutMs = 90_000, env }: CommandOptions): Promise<string> {
  if (signal.aborted) return Promise.reject(new Error('Befehl abgebrochen.'))
  return new Promise((resolve, reject) => {
    const windows = process.platform === 'win32'
    const shellCommand = windows ? '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; ' + command : command
    const child = spawn(windows ? 'powershell.exe' : '/bin/sh', windows ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', shellCommand] : ['-c', shellCommand], {
      cwd, env: env ? { ...process.env, ...env } : process.env, windowsHide: true, detached: !windows, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = '', settled = false, timedOut = false, lastEmit = 0
    let pending: ReturnType<typeof setTimeout> | undefined
    const flush = () => { clearTimeout(pending); pending = undefined; lastEmit = Date.now(); if (output) onOutput(output) }
    const append = (chunk: string) => {
      output = (output + chunk).slice(-24_000)
      if (Date.now() - lastEmit >= 80) flush()
      else if (!pending) pending = setTimeout(flush, 80)
    }
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', append); child.stderr.on('data', append)
    const terminate = () => {
      if (settled || !child.pid) return
      if (windows) execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => { if (child.exitCode === null) child.kill() })
      else { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }
    }
    const abort = () => terminate()
    signal.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => { timedOut = true; terminate() }, timeoutMs)
    const finish = (error?: Error, code?: number | null) => {
      if (settled) return
      settled = true; clearTimeout(timeout); signal.removeEventListener('abort', abort); flush()
      if (signal.aborted) reject(new Error('Befehl abgebrochen.'))
      else if (timedOut) reject(new Error(`Zeitlimit für den Befehl erreicht.\n${output}`))
      else if (error || code !== 0) reject(new Error(`Exit: ${code ?? 'Fehler'}\n${output || error?.message || 'Befehl fehlgeschlagen.'}`))
      else resolve(output || 'Befehl erfolgreich beendet (keine Ausgabe).')
    }
    child.once('error', error => finish(error))
    child.once('close', code => finish(undefined, code))
    if (signal.aborted) abort()
  })
}
