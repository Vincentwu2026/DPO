import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

// Some shells/IDEs export this, which makes Electron run as plain Node and crash on startup.
delete process.env['ELECTRON_RUN_AS_NODE']

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          settings: resolve('src/renderer/settings/index.html'),
          hud: resolve('src/renderer/hud/index.html'),
          report: resolve('src/renderer/report/index.html'),
          calibration: resolve('src/renderer/calibration/index.html')
        }
      }
    }
  }
})
