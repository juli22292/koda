import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const version = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [react()],
    resolve: { alias: { '@': resolve('src/renderer/src') } },
  },
})
