const { spawnSync, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const semver = require('semver')
const { publishRelease } = require('./publish-release.cjs')
const { githubRequest } = require('./github-client.cjs')

function command(executable, args, env = process.env) {
  const result = spawnSync(executable, args, { stdio: 'inherit', windowsHide: true, env })
  if (result.status !== 0) throw new Error(`${path.basename(executable)} ist fehlgeschlagen. Es wurde kein öffentliches Update freigegeben.`)
}
function npm(args, env) {
  const cli = process.env.npm_execpath
  if (!cli) throw new Error('Bitte mit npm run release -- patch starten.')
  command(process.execPath, [cli, ...args], env)
}
function git(...args) { return execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim() }

;(async () => {
  const requested = process.argv[2]
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const version = ['patch', 'minor', 'major'].includes(requested) ? semver.inc(pkg.version, requested) : semver.valid(requested)
  if (!version || !semver.gt(version, pkg.version)) throw new Error('Gib eine höhere Version an, z. B. npm run release -- patch oder npm run release -- 0.3.0.')
  if (git('status', '--porcelain')) throw new Error('Bitte zuerst deine Änderungen committen. Ein Release benötigt einen sauberen Git-Stand.')
  if (git('branch', '--show-current') !== 'main') throw new Error('Releases werden aus main erstellt. Bitte vorher wechseln bzw. Änderungen übernehmen.')
  if (git('remote', 'get-url', 'origin') !== 'https://github.com/juli22292/koda.git') throw new Error('Das Quellcode-Remote stimmt nicht mit juli22292/koda überein.')
  npm(['version', version, '--no-git-tag-version'])
  npm(['test'])
  npm(['run', 'dist'])
  npm(['run', 'test:e2e'], { ...process.env, KODA_TEST_EXE: path.resolve('release/win-unpacked/Koda.exe') })
  npm(['run', 'test:updates'])
  command('git', ['add', 'package.json', 'package-lock.json'])
  command('git', ['commit', '-m', `Release Koda ${version}`])
  command('git', ['tag', '-a', `v${version}`, '-m', `Koda ${version}`])
  const source = await githubRequest('/repos/juli22292/koda')
  if (!source.private) throw new Error('Das Quellcode-Repository ist öffentlich. Vor dem Push und der Veröffentlichung wieder auf privat stellen.')
  command('git', ['push', 'origin', 'main', '--follow-tags'])
  await publishRelease()
})().catch(error => { console.error(error.message); process.exitCode = 1 })
