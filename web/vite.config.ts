import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ['kay-apogamic-kandis.ngrok-free.dev'],
    // Same-origin in production (Litestar serves the built assets), so the dev proxy
    // keeps paths identical between dev and prod -- no CORS, no base-URL switching.
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: false },
      '/mcp': { target: 'http://localhost:8000', changeOrigin: false },
    },
  },
})
