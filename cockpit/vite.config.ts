import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Alpaca keys stay in the Vite proxy (market desk). Terac keys do not —
// Cockpit talks to /backend over /api.
//   ALPACA_API_KEY=...
//   ALPACA_SECRET_KEY=...
const envDir = fileURLToPath(new URL('..', import.meta.url))

// backend/.env is where the user actually keeps keys — read it for the
// Alpaca proxy too (simple KEY=value parse, values never enter the bundle)
function readBackendEnv(): Record<string, string> {
  try {
    const raw = readFileSync(fileURLToPath(new URL('../backend/.env', import.meta.url)), 'utf8')
    const out: Record<string, string> = {}
    for (const line of raw.split('\n')) {
      const eq = line.indexOf('=')
      if (eq < 1 || line.trim().startsWith('#')) continue
      out[line.slice(0, eq).trim()] = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
    }
    return out
  } catch {
    return {}
  }
}

export default defineConfig(({ mode }) => {
  const env = { ...readBackendEnv(), ...loadEnv(mode, envDir, '') }
  const key = env.ALPACA_API_KEY ?? env.APCA_API_KEY_ID ?? ''
  const secret = env.ALPACA_SECRET_KEY ?? env.APCA_API_SECRET_KEY ?? ''
  const authHeaders = key && secret ? { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret } : undefined

  return {
    plugins: [react()],
    envDir,
    define: {
      __ALPACA_ORDERS__: JSON.stringify(Boolean(key && secret)),
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
        '/review': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
        '/subscribe': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
        '/alpaca/data': {
          target: 'https://data.alpaca.markets',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/alpaca\/data/, ''),
          headers: authHeaders,
        },
        '/alpaca/paper': {
          target: 'https://paper-api.alpaca.markets',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/alpaca\/paper/, ''),
          headers: authHeaders,
        },
      },
    },
  }
})
