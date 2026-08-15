import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const envPath = resolve(root, '.env')

function loadDotenv(path: string, overwrite = false) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!overwrite && process.env[key] != null && process.env[key] !== '') continue
    try {
      process.env[key] = /%[0-9A-Fa-f]{2}/.test(value) ? decodeURIComponent(value) : value
    } catch {
      process.env[key] = value
    }
  }
}

loadDotenv(envPath)
loadDotenv(resolve(root, 'backend/.env'), true)

export const TERAC_API_KEY = (process.env.TERAC_API_KEY ?? '').trim()
export const PORT = Number(process.env.PORT ?? 8787)
export const X_BEARER_TOKEN = (process.env.X_BEARER_TOKEN ?? process.env.TWITTER_BEARER_TOKEN ?? '').trim()
export const GITHUB_TOKEN = (process.env.GITHUB_TOKEN ?? '').trim()
export const GITHUB_REPO = (process.env.GITHUB_REPO ?? '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')

// Linq messaging (customer service): integration token, the org's
// messaging-enabled number to send from, and the ONLY recipient we will
// ever text (a test phone) — real customers are never messaged from a demo.
export const LINQ_INTEGRATION_TOKEN = (process.env.LINQ_INTEGRATION_TOKEN ?? '').trim()
export const LINQ_SEND_FROM = (process.env.LINQ_SEND_FROM ?? '').trim()
export const LINQ_TEST_PHONE = (process.env.LINQ_TEST_PHONE ?? '').trim()

// Payments (finance mode). Stripe must be a TEST key — the backend refuses
// live keys. Whop is read-only.
export const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY ?? '').trim()
export const WHOP_API_KEY = (process.env.WHOP_API_KEY ?? '').trim()
