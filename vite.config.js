import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { fedextoolApiAutostart } from './vite-plugin-fedextool-api.mjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    fedextoolApiAutostart(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3847',
        changeOrigin: true,
        /** POST /api/run can take many minutes (Playwright check-in). Default proxy times out → 502 Bad Gateway. */
        timeout: 1_800_000,
        proxyTimeout: 1_800_000,
      },
      /** Same-origin FedEx reverse proxy for Trip Buddy iframe (see server/trip-buddy-proxy.mjs) */
      '/embed': {
        target: 'http://127.0.0.1:3847',
        changeOrigin: true,
        timeout: 1_800_000,
        proxyTimeout: 1_800_000,
      },
    },
  },
})
