import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/auth': 'http://localhost:8000',
      '/portfolio': 'http://localhost:8000',
      '/market': 'http://localhost:8000',
      '/advice': 'http://localhost:8000',
      '/risk-profile': 'http://localhost:8000',
    },
  },
})
