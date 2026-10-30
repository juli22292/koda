const { execFileSync } = require('node:child_process')

let cachedToken
function githubToken() {
  if (cachedToken) return cachedToken
  cachedToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (!cachedToken) {
    // Ask the configured Git credential helper. Never print or persist the returned credential.
    let credential
    try {
      credential = execFileSync('git', ['credential', 'fill'], {
        input: 'protocol=https\nhost=github.com\npath=juli22292/koda.git\n\n',
        encoding: 'utf8', windowsHide: true, timeout: 20000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch { throw new Error('Keine GitHub-Anmeldung verfügbar. Melde dich über Git Credential Manager an oder setze GH_TOKEN für den Veröffentlichungsprozess.') }
    cachedToken = credential.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9)
  }
  if (!cachedToken) throw new Error('Die GitHub-Anmeldung enthält keinen Zugriffsschlüssel.')
  return cachedToken
}

async function githubRequest(endpoint, { method = 'GET', body, headers = {}, allow404 = false, raw = false } = {}) {
  const url = new URL(endpoint.startsWith('https:') ? endpoint : `https://api.github.com${endpoint}`)
  if (!['api.github.com', 'uploads.github.com'].includes(url.hostname) || url.protocol !== 'https:') throw new Error('Unzulässiger GitHub-API-Host.')
  const response = await fetch(url, {
    method,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${githubToken()}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Koda-release-tools', ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(raw ? 600000 : 30000),
  })
  if (allow404 && response.status === 404) return null
  const result = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}: ${result?.message || response.statusText}`)
  return result
}

module.exports = { githubRequest }
