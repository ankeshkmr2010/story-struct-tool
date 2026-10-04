import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Same-origin in production (Litestar serves the built assets), so the dev proxy
    // keeps paths identical between dev and prod -- no CORS, no base-URL switching.
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
