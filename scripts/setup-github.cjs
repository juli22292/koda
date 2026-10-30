const { githubRequest } = require('./github-client.cjs')

;(async () => {
  // Repository visibility is an owner preference and is never changed here.
  const source = await githubRequest('/repos/juli22292/koda')
  let downloads = await githubRequest('/repos/juli22292/koda-releases', { allow404: true })
  if (!downloads) {
    downloads = await githubRequest('/user/repos', { method: 'POST', body: { name: 'koda-releases', description: 'Windows-Installer und automatische Updates für Koda. Enthält keinen Projektquellcode.', private: false, auto_init: true, has_issues: false, has_projects: false, has_wiki: false } })
    const current = await githubRequest('/repos/juli22292/koda-releases/contents/README.md')
    const readme = '# Koda für Windows\n\nInstaller und Updates für den Koda-Desktop-Client.\n\n## Download\n\nDie aktuelle Version findest du unter [Releases](https://github.com/juli22292/koda-releases/releases/latest). Lade die Datei `Koda-Setup-…-x64.exe` herunter und führe sie aus.\n\nKoda verwendet deine eigenen API-Keys. Persönliche Zugangsdaten sind nicht im Installer enthalten.\n\n## Updates\n\nNach der Installation prüft Koda selbst auf neue Versionen. Ein Update-Symbol links neben den Fensterbuttons zeigt verfügbare Updates an. Der Neustart erfolgt erst nach deiner Bestätigung.\n\nDieses Repository enthält ausschließlich veröffentlichte Installationsdateien und Updateinformationen. Der Entwicklungsquellcode liegt in einem separaten öffentlichen Repository.\n'
    await githubRequest('/repos/juli22292/koda-releases/contents/README.md', { method: 'PUT', body: { message: 'Describe Koda downloads and automatic updates', sha: current.sha, content: Buffer.from(readme).toString('base64') } })
  }
  if (downloads.private) throw new Error('Das Download-Repository ist privat. Eine öffentliche Updatequelle ist erforderlich.')
  console.log(JSON.stringify({ source: source.full_name, sourcePrivate: source.private, sourceDefaultBranch: source.default_branch, sourceSize: source.size, downloads: downloads.full_name, downloadsPublic: !downloads.private }))
})().catch(error => { console.error(error.message); process.exitCode = 1 })
