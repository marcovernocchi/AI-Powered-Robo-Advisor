import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// react-aria@3.48.0 declares *.mjs exports but only ships *.js
const reactAriaMjsFix = {
  name: 'fix-react-aria-mjs',
  setup(build) {
    build.onResolve({ filter: /^react-aria\// }, (args) => {
      const subpath = args.path.slice('react-aria/'.length)
      const resolved = path.resolve(__dirname, 'node_modules/react-aria/dist/exports', subpath + '.js')
      if (fs.existsSync(resolved)) {
        return { path: resolved }
      }
    })
  },
}

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    esbuildOptions: {
      plugins: [reactAriaMjsFix],
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/auth': 'http://localhost:8000',
      '/portfolio': 'http://localhost:8000',
      '/market': 'http://localhost:8000',
      '/advice': 'http://localhost:8000',
      '/risk-profile': 'http://localhost:8000',
      '/backtest': 'http://localhost:8000',
    },
  },
})
