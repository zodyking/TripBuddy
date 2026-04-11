import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function apiPort() {
  return process.env.FEDEX_TOOL_API_PORT ?? '3847'
}

async function apiHealthOk() {
  try {
    const r = await fetch(`http://127.0.0.1:${apiPort()}/api/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return r.ok
  } catch {
    return false
  }
}

async function waitForApiHealthy(maxMs = 45_000, stepMs = 250) {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (await apiHealthOk()) return true
    await new Promise((r) => setTimeout(r, stepMs))
  }
  return false
}

/**
 * When running `vite` alone, start the Fastify API so the UI and SSE work.
 * Skips if something already listens (e.g. `npm run dev` with concurrently).
 */
export function fedextoolApiAutostart() {
  /** @type {import('child_process').ChildProcess | null} */
  let child = null
  let startedByPlugin = false
  /** @type {(() => void) | undefined} */
  let removeListeningListener

  return {
    name: 'fedextool-api-autostart',
    apply: 'serve',
    enforce: 'pre',
    configureServer(server) {
      const tryStart = async () => {
        if (process.env.VITE_NO_API_AUTOSTART === '1') return
        if (await apiHealthOk()) {
          console.log(`[fedextool-api] API already up on :${apiPort()}`)
          return
        }
        const serverDir = path.join(__dirname, 'server')
        const entry = path.join(serverDir, 'index.mjs')
        if (!fs.existsSync(entry)) {
          console.warn('[fedextool-api] server/index.mjs missing; skip autostart')
          return
        }
        console.log(`[fedextool-api] Starting API on :${apiPort()}…`)
        try {
          child = spawn(process.execPath, [entry], {
            cwd: serverDir,
            stdio: 'inherit',
            env: { ...process.env },
          })
        } catch (err) {
          console.error('[fedextool-api] Failed to spawn API:', err)
          return
        }
        startedByPlugin = true
        child.on('error', (err) => {
          console.error('[fedextool-api] API process error:', err)
        })
        child.on('exit', (code) => {
          if (code != null && code !== 0) {
            console.warn(`[fedextool-api] API exited with code ${code}`)
          }
          child = null
          startedByPlugin = false
        })
        const up = await waitForApiHealthy()
        if (!up) {
          console.error(
            `[fedextool-api] API did not become healthy on :${apiPort()} within 45s (port in use, missing deps, or Playwright install failed — check server terminal).`,
          )
        } else {
          console.log(`[fedextool-api] API is ready on :${apiPort()}`)
        }
      }

      const httpServer = server.httpServer
      if (httpServer?.listening) {
        void tryStart()
      } else if (httpServer) {
        const onListening = () => {
          void tryStart()
        }
        httpServer.once('listening', onListening)
        removeListeningListener = () =>
          httpServer.off('listening', onListening)
      } else {
        setTimeout(() => void tryStart(), 0)
      }

      return () => {
        removeListeningListener?.()
        removeListeningListener = undefined
        if (child && startedByPlugin) {
          child.kill('SIGTERM')
          child = null
          startedByPlugin = false
        }
      }
    },
  }
}
