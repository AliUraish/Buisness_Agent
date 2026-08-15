// Owns the Stripe (TEST MODE ONLY) and Whop reads. Keys stay here.
// Read-only by design: balance + payment lists. This backend never
// creates charges, refunds, or payouts.
//
// Safety rail: a Stripe key that is not sk_test_/rk_test_ is REFUSED —
// a live-money key can never power a demo dashboard by accident.

import { STRIPE_SECRET_KEY, WHOP_API_KEY } from './env.ts'

export interface RailSummary {
  live: boolean
  totalCents: number | null // sum of recent successful payments
  count: number | null
  currency: string
  recent: { id: string; amountCents: number; desc: string; created: number }[]
  note: string | null
}

const OFF = (note: string): RailSummary => ({ live: false, totalCents: null, count: null, currency: 'usd', recent: [], note })

// 'live' keys are allowed for READS ONLY — this module has no write
// endpoints (no charges, refunds, or payouts are ever created). The mode
// is always reported so the UI can label the number honestly.
// For a live key, prefer a restricted read-only key (rk_live_…).
export function stripeMode(): 'live' | 'test' | null {
  if (/^(sk|rk)_test_/.test(STRIPE_SECRET_KEY)) return 'test'
  if (/^(sk|rk)_live_/.test(STRIPE_SECRET_KEY)) return 'live'
  return null
}

export function isStripeLive(): boolean {
  return stripeMode() != null
}

export function isWhopLive(): boolean {
  return Boolean(WHOP_API_KEY)
}

async function getJson(url: string, headers: Record<string, string>, timeoutMs = 12000): Promise<any> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers, signal: ctl.signal })
    const raw = await res.text()
    let json: any = null
    try {
      json = raw ? JSON.parse(raw) : null
    } catch {
      json = { raw }
    }
    if (!res.ok) throw new Error(json?.error?.message ?? json?.message ?? `HTTP ${res.status}: ${raw.slice(0, 120)}`)
    return json
  } finally {
    clearTimeout(t)
  }
}

export async function stripeSummary(): Promise<RailSummary> {
  if (!STRIPE_SECRET_KEY) return OFF('Set STRIPE_SECRET_KEY=sk_… in the workspace .env.')
  if (!isStripeLive()) return OFF('Unrecognized Stripe key format — expected sk_test_/rk_test_/sk_live_/rk_live_.')
  try {
    const json = await getJson('https://api.stripe.com/v1/charges?limit=15', {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    })
    const rows: any[] = (json?.data ?? []).filter((c: any) => c.status === 'succeeded' || c.paid)
    return {
      live: true,
      totalCents: rows.reduce((s, c) => s + (c.amount ?? 0), 0),
      count: rows.length,
      currency: rows[0]?.currency ?? 'usd',
      recent: rows.slice(0, 10).map((c) => ({
        id: String(c.id),
        amountCents: c.amount ?? 0,
        desc: c.description ?? c.calculated_statement_descriptor ?? 'charge',
        created: (c.created ?? 0) * 1000,
      })),
      note: null,
    }
  } catch (e) {
    return OFF(`Stripe: ${(e instanceof Error ? e.message : String(e)).slice(0, 140)}`)
  }
}

// ── Revenue earned today — the hackathon prize metric ─────────────
export interface TodayRevenue {
  live: boolean
  mode: 'live' | 'test' | null
  grossCents: number // succeeded charges today
  netCents: number // gross − refunds − fees
  feeCents: number
  refundCents: number
  count: number // number of payments
  currency: string
  sinceMs: number // local midnight this was computed from
  note: string | null
}

// pure so it can be unit-tested: fold Stripe balance transactions into totals
export function sumBalanceTx(rows: { type: string; amount: number; fee?: number }[]): {
  grossCents: number
  feeCents: number
  refundCents: number
  netCents: number
  count: number
} {
  let grossCents = 0
  let feeCents = 0
  let refundCents = 0
  let count = 0
  for (const r of rows) {
    if (r.type === 'charge' || r.type === 'payment') {
      grossCents += r.amount
      feeCents += r.fee ?? 0
      count++
    } else if (r.type === 'refund' || r.type === 'payment_refund') {
      refundCents += -r.amount // refund amounts are negative
    }
  }
  return { grossCents, feeCents, refundCents, netCents: grossCents - refundCents - feeCents, count }
}

export async function stripeToday(): Promise<TodayRevenue> {
  const mode = stripeMode()
  const base: TodayRevenue = {
    live: false,
    mode,
    grossCents: 0,
    netCents: 0,
    feeCents: 0,
    refundCents: 0,
    count: 0,
    currency: 'usd',
    sinceMs: 0,
    note: null,
  }
  if (!STRIPE_SECRET_KEY) return { ...base, note: 'Set STRIPE_SECRET_KEY=sk_… in the workspace .env.' }
  if (!mode) return { ...base, note: 'Unrecognized Stripe key format.' }

  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const since = Math.floor(midnight.getTime() / 1000)

  try {
    const rows: any[] = []
    let startingAfter: string | null = null
    // up to 3 pages × 100 — plenty for a demo day, bounded on purpose
    for (let page = 0; page < 3; page++) {
      const url =
        `https://api.stripe.com/v1/balance_transactions?limit=100&created[gte]=${since}` +
        (startingAfter ? `&starting_after=${startingAfter}` : '')
      const json = await getJson(url, { Authorization: `Bearer ${STRIPE_SECRET_KEY}` })
      const data: any[] = json?.data ?? []
      rows.push(...data)
      if (!json?.has_more || data.length === 0) break
      startingAfter = data[data.length - 1].id
    }
    const totals = sumBalanceTx(rows)
    return {
      ...base,
      live: true,
      ...totals,
      currency: rows[0]?.currency ?? 'usd',
      sinceMs: midnight.getTime(),
    }
  } catch (e) {
    return { ...base, note: `Stripe: ${(e instanceof Error ? e.message : String(e)).slice(0, 140)}` }
  }
}

export async function whopSummary(): Promise<RailSummary> {
  if (!isWhopLive()) return OFF('Set WHOP_API_KEY=… in the workspace .env.')
  try {
    const json = await getJson('https://api.whop.com/api/v2/payments?per=15', {
      Authorization: `Bearer ${WHOP_API_KEY}`,
    })
    const rows: any[] = (json?.data ?? []).filter((p: any) => (p.status ?? 'paid') === 'paid' || p.paid_at)
    return {
      live: true,
      totalCents: rows.reduce((s, p) => s + Math.round(Number(p.final_amount ?? p.subtotal ?? 0) * 100), 0),
      count: rows.length,
      currency: rows[0]?.currency ?? 'usd',
      recent: rows.slice(0, 10).map((p) => ({
        id: String(p.id),
        amountCents: Math.round(Number(p.final_amount ?? p.subtotal ?? 0) * 100),
        desc: p.product?.title ?? p.plan?.internal_notes ?? 'payment',
        created: p.paid_at ? Number(p.paid_at) * 1000 : Date.now(),
      })),
      note: null,
    }
  } catch (e) {
    return OFF(`Whop: ${(e instanceof Error ? e.message : String(e)).slice(0, 140)}`)
  }
}
