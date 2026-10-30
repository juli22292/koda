import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import { openPromise } from 'yauzl'

export function insidePath(root: string, relative: string): string {
  const target = path.resolve(root, relative)
  const remainder = path.relative(path.resolve(root), target)
  if (!remainder || remainder === '..' || remainder.startsWith(`..${path.sep}`) || path.isAbsolute(remainder)) throw new Error('Pfad außerhalb des Koda-Werkzeugordners.')
  return target
}
export async function fileHash(file: string, algorithm: 'sha256' | 'sha512'): Promise<string> {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
export async function extractToolArchive(archive: string, destination: string, signal: AbortSignal): Promise<void> {
  const zip = await openPromise(archive, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true })
  let total = 0
  try {
    if (zip.entryCount > 100_000) throw new Error('Das Werkzeugarchiv enthält zu viele Dateien.')
    for await (const entry of zip.eachEntry()) {
      signal.throwIfAborted()
      const name = entry.fileName
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000
      if (mode === 0o120000 || (mode && ![0o100000, 0o040000].includes(mode))) throw new Error('Dateiverweise werden in Werkzeugarchiven nicht unterstützt.')
      const segments = name.replace(/\/$/, '').split('/')
      if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[:\\\x00-\x1f]/.test(segment) || /[. ]$/.test(segment) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) throw new Error('Unsicherer Dateiname im Werkzeugarchiv.')
      const target = insidePath(destination, name)
      total += entry.uncompressedSize
      if (total > 3 * 1024 ** 3) throw new Error('Das entpackte Werkzeugarchiv ist zu groß.')
      if (name.endsWith('/')) { await fs.mkdir(target, { recursive: true }); continue }
      await fs.mkdir(path.dirname(target), { recursive: true })
      const stream = await zip.openReadStreamPromise(entry)
      await pipeline(stream, createWriteStream(target, { flags: 'wx' }), { signal })
    }
  } finally { zip.close() }
}
export async function jarKind(file: string): Promise<'plugin' | 'jar' | undefined> {
  let zip
  try {
    zip = await openPromise(file, { lazyEntries: true, validateEntrySizes: true })
    if (zip.entryCount > 100_000) return undefined
    let compiled = false, plugin = false
    for await (const entry of zip.eachEntry()) {
      if (['plugin.yml', 'paper-plugin.yml', 'bungee.yml', 'velocity-plugin.json', 'fabric.mod.json', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml'].includes(entry.fileName)) plugin = true
      if (entry.fileName.endsWith('.class')) compiled = true
    }
    return compiled ? plugin ? 'plugin' : 'jar' : undefined
  } catch { return undefined } finally { zip?.close() }
}
