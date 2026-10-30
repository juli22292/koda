import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { FileEntry } from '../shared/types'

const HIDDEN = new Set(['node_modules', '.git', 'dist', 'out', '.next', '.venv', '__pycache__', '.DS_Store'])
const SECRET = /(^\.env($|\.)|\.(pem|key|p12|pfx)$|^credentials\.json$|^secrets?\.)/i
export function isSensitive(relativePath: string) {
  return relativePath.split(/[\\/]/).some(segment => SECRET.test(segment))
}
function isInside(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}
export async function workspacePath(root: string, relativePath = '.', forWrite = false): Promise<string> {
  if (typeof relativePath !== 'string' || relativePath.includes('\0')) throw new Error('Ungültiger Dateipfad.')
  if (path.isAbsolute(relativePath)) throw new Error('Bitte einen relativen Pfad im Projekt verwenden.')
  const realRoot = await fs.realpath(root)
  const target = path.resolve(realRoot, relativePath)
  if (!isInside(realRoot, target)) throw new Error('Der Pfad liegt außerhalb des Projekts.')
  if (isSensitive(relativePath)) throw new Error('Dateien mit Zugangsdaten werden nicht automatisch geöffnet oder verändert.')
  if (relativePath.split(/[\\/]/).some(segment => segment.toLowerCase() === '.git')) throw new Error('Das Git-Verzeichnis ist geschützt.')
  let existing = target
  while (true) {
    try {
      const resolved = await fs.realpath(existing)
      if (!isInside(realRoot, resolved)) throw new Error('Der Dateiverweis führt aus dem Projekt heraus.')
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !forWrite) throw error
      const parent = path.dirname(existing)
      if (parent === existing) throw error
      existing = parent
    }
  }
  return target
}
export async function listWorkspaceFiles(root: string, relativePath = '.'): Promise<FileEntry[]> {
  const target = await workspacePath(root, relativePath)
  const entries = await fs.readdir(target, { withFileTypes: true })
  return entries.filter(e => !HIDDEN.has(e.name) && !SECRET.test(e.name) && !e.isSymbolicLink())
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, 350).map(e => ({ name: e.name, directory: e.isDirectory(), path: path.relative(root, path.join(target, e.name)).replaceAll('\\', '/') }))
}
export async function readWorkspaceFile(root: string, relativePath: string): Promise<string> {
  const target = await workspacePath(root, relativePath)
  const info = await fs.stat(target)
  if (!info.isFile()) throw new Error('Der Pfad ist keine Datei.')
  if (info.size > 1024 * 1024) throw new Error('Die Datei ist größer als 1 MB. Bitte eine kleinere Datei wählen.')
  const content = await fs.readFile(target, 'utf8')
  if (content.includes('\0')) throw new Error('Binärdateien können nicht als Text geöffnet werden.')
  return content
}
export async function writeWorkspaceFile(root: string, relativePath: string, content: string): Promise<void> {
  if (Buffer.byteLength(content, 'utf8') > 1024 * 1024) throw new Error('Die Änderung überschreitet 1 MB.')
  const target = await workspacePath(root, relativePath, true)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await workspacePath(root, relativePath, true)
  const temporary = `${target}.koda-${crypto.randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, content, { flag: 'wx' })
    await fs.rename(temporary, target)
  } finally { await fs.unlink(temporary).catch(() => {}) }
}
