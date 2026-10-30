const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const yaml = require('js-yaml')
const { githubRequest } = require('./github-client.cjs')

async function publishRelease() {
  const pkg = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf8'))
  const config = pkg.build.publish
  if (config.provider !== 'github' || config.owner !== 'juli22292' || config.repo !== 'koda-releases') throw new Error('Unerwartetes Veröffentlichungsziel. Der Quellcode darf nicht veröffentlicht werden.')
  const source = await githubRequest('/repos/juli22292/koda')
  if (!source.private) throw new Error('Das Quellcode-Repository ist öffentlich. Vor dem Veröffentlichen wieder auf privat stellen.')
  const repo = `${config.owner}/${config.repo}`
  const target = await githubRequest(`/repos/${repo}`)
  if (target.private) throw new Error('Die Downloadquelle muss öffentlich erreichbar sein.')

  const installerName = `Koda-Setup-${pkg.version}-x64.exe`
  const filenames = [installerName, `${installerName}.blockmap`, 'latest.yml']
  const manifest = yaml.load(await fs.readFile(path.join('release', 'latest.yml'), 'utf8'))
  const installer = await fs.readFile(path.join('release', installerName))
  const info = manifest.files?.find(file => file.url === installerName)
  if (manifest.version !== pkg.version || !info || info.sha512 !== createHash('sha512').update(installer).digest('base64') || info.size !== installer.length) throw new Error('Installer und Update-Metadaten passen nicht zusammen. Bitte neu bauen.')
  const buffers = new Map([[installerName, installer]])
  for (const filename of filenames.slice(1)) buffers.set(filename, await fs.readFile(path.join('release', filename)))

  const tag = `v${pkg.version}`
  let release = await githubRequest(`/repos/${repo}/releases/tags/${tag}`, { allow404: true })
  if (release && !release.draft) throw new Error(`${tag} wurde bereits veröffentlicht. Verwende eine neue Versionsnummer.`)
  if (!release) {
    const notes = await fs.readFile(path.join('resources', 'release-notes.md'), 'utf8').catch(() => `Koda ${pkg.version} für Windows.`)
    release = await githubRequest(`/repos/${repo}/releases`, { method: 'POST', body: { tag_name: tag, name: `Koda ${pkg.version}`, body: notes, draft: true, prerelease: false } })
  }
  // Upload all files to a draft; the public feed advances only after every upload succeeds.
  for (const filename of filenames) {
    const previous = release.assets?.find(asset => asset.name === filename)
    if (previous) await githubRequest(`/repos/${repo}/releases/assets/${previous.id}`, { method: 'DELETE' })
    const buffer = buffers.get(filename)
    const asset = await githubRequest(`https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(filename)}`, {
      method: 'POST', raw: true, body: buffer,
      headers: { 'Content-Type': filename.endsWith('.yml') ? 'application/x-yaml' : 'application/octet-stream', 'Content-Length': String(buffer.length) },
    })
    if (asset.size !== buffer.length) throw new Error(`Unvollständiger Upload: ${filename}. Der Release bleibt als Entwurf gespeichert.`)
    console.log(`Hochgeladen: ${filename}`)
  }
  const published = await githubRequest(`/repos/${repo}/releases/${release.id}`, { method: 'PATCH', body: { draft: false, make_latest: 'true' } })
  console.log(`Veröffentlicht: ${published.html_url}`)
  return published.html_url
}

module.exports = { publishRelease }
if (require.main === module) publishRelease().catch(error => { console.error(error.message); process.exitCode = 1 })
