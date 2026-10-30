const { spawnSync } = require('node:child_process')

const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', 'nsis', '--x64', '--publish', 'never'], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, ELECTRON_BUILDER_COMPRESSION_LEVEL: process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL || '5' },
})
process.exitCode = result.status ?? 1
