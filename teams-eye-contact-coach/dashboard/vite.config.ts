import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  // Dev server stays on loopback; production is served by Azure Static Web Apps.
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: {
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Separate long-lived vendor code from app code so it caches independently.
        codeSplitting: {
          groups: [
            { name: 'msal', test: /node_modules[\\/]@azure[\\/]/ },
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/
            }
          ]
        }
      }
    }
  },
  test: { environment: 'node', include: ['test/**/*.test.ts'] }
})
