import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { isSensitive, listWorkspaceFiles, readWorkspaceFile, workspacePath, writeWorkspaceFile } from '../src/main/workspace'

let root: string, outside: string
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'koda-workspace-test-'))
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'koda-outside-test-'))
  await fs.writeFile(path.join(root, 'hello.txt'), 'hello\n')
  await fs.writeFile(path.join(outside, 'private.txt'), 'outside')
})

test('normal project files can be read and written atomically', async () => {
  assert.equal(await readWorkspaceFile(root, 'hello.txt'), 'hello\n')
  await writeWorkspaceFile(root, 'nested/new.ts', 'export const value = 42\n')
  assert.equal(await readWorkspaceFile(root, 'nested/new.ts'), 'export const value = 42\n')
  assert.equal((await fs.readdir(path.join(root, 'nested'))).some(name => name.endsWith('.tmp')), false)
})
test('relative traversal is denied for reading and writing', async () => {
  await assert.rejects(workspacePath(root, '../private.txt'), /außerhalb/)
  await assert.rejects(workspacePath(root, 'nested/../../private.txt', true), /außerhalb/)
})
test('absolute paths and NUL bytes are denied', async () => {
  await assert.rejects(workspacePath(root, path.join(root, 'hello.txt')), /relativen/)
  await assert.rejects(workspacePath(root, 'hello\0.txt'), /Ungültiger/)
})
test('credentials and git internals are protected', async () => {
  for (const file of ['.env', '.env.local', 'config/key.pem', 'credentials.json', 'secrets.json']) {
    assert.equal(isSensitive(file), true)
    await assert.rejects(workspacePath(root, file, true), /Zugangsdaten/)
  }
  await assert.rejects(workspacePath(root, '.git/config', true), /Git-Verzeichnis/)
  await assert.rejects(workspacePath(root, '.GiT/config', true), /Git-Verzeichnis/)
  assert.equal(isSensitive('src/keybindings.ts'), false)
})
test('file listing sorts folders first and excludes generated and secret files', async () => {
  await fs.mkdir(path.join(root, 'node_modules'), { recursive: true })
  await fs.writeFile(path.join(root, '.env.local'), 'KEY=dummy')
  const entries = await listWorkspaceFiles(root)
  assert.equal(entries[0].directory, true)
  assert.equal(entries.some(e => e.name === 'node_modules' || e.name === '.env.local'), false)
  assert.equal(entries.some(e => e.name === 'hello.txt'), true)
})
test('directory links cannot escape the project', async t => {
  try { await fs.symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('OS does not permit symlinks'); return } throw error }
  await assert.rejects(readWorkspaceFile(root, 'escape/private.txt'), /Projekt heraus/)
  await assert.rejects(writeWorkspaceFile(root, 'escape/new.txt', 'no'), /Projekt heraus/)
  assert.equal((await listWorkspaceFiles(root)).some(e => e.name === 'escape'), false)
})
test('binary and oversized files are rejected', async () => {
  await fs.writeFile(path.join(root, 'binary.dat'), Buffer.from([0, 1, 2]))
  await assert.rejects(readWorkspaceFile(root, 'binary.dat'), /Binärdateien/)
  await assert.rejects(writeWorkspaceFile(root, 'large.txt', 'x'.repeat(1024 * 1024 + 1)), /1 MB/)
})
