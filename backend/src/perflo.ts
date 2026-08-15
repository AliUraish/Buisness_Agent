// Perflo — "a bank account your agent can actually use". Read-only:
// balance + activity. Token stays here. Docs: https://docs.perflo.ai
import { PERFLO_TOKEN } from './env.ts'

const BASE = 'https://api-gateway.perflo.ai'

export interface PerfloSummary {
  live: boolean
  balance: number | null // dollars
  available: number | null
  currency: string
  recent: { kind: string; amount: number; at: string }[]
  note: string | null
}

export function isPerfloLive(): boolean {
  return Boolean(PERFLO_TOKEN)
}

async function get(path: string, timeoutMs = 12000): Promise<any> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${PERFLO_TOKEN}` },
      signal: ctl.signal,
    })
    const raw = await res.text()
    let json: any = null
    try {
      json = raw ? JSON.parse(raw) : null
    } catch {
      json = { raw }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(json?.detail ?? json?.message ?? raw).toString().slice(0, 140)}`)
    return json
  } finally {
    clearTimeout(t)
  }
}

function toNum(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function perfloSummary(): Promise<PerfloSummary> {
  if (!isPerfloLive()) {
    return { live: false, balance: null, available: null, currency: 'USD', recent: [], note: 'Set PERFLO_TOKEN in the workspace .env.' }
  }
  try {
    const [accounts, activity] = await Promise.all([get('/v1/accounts'), get('/v1/activity?limit=15')])
    const list: any[] = Array.isArray(accounts) ? accounts : accounts?.accounts ?? accounts?.data ?? []
    let balance = 0
    let available = 0
    for (const a of list) {
      balance += toNum(a?.balance) ?? 0
      available += toNum(a?.available_balance) ?? toNum(a?.balance) ?? 0
    }
    const acts: any[] = Array.isArray(activity) ? activity : activity?.activity ?? activity?.data ?? []
    return {
      live: true,
      balance,
      available,
      currency: list[0]?.currency ?? 'USD',
      recent: acts.slice(0, 15).map((e: any) => ({
        kind: String(e?.kind ?? 'activity'),
        amount: toNum(e?.amount) ?? 0,
        at: String(e?.created_at ?? e?.at ?? ''),
      })),
      note: null,
    }
  } catch (e) {
    return {
      live: false,
      balance: null,
      available: null,
      currency: 'USD',
      recent: [],
      note: `Perflo: ${(e instanceof Error ? e.message : String(e)).slice(0, 140)}`,
    }
  }
}
