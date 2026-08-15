// Thin client for the Business_Agent backend's payment reads (Stripe test + Whop).

export interface RailSummary {
  live: boolean
  totalCents: number | null
  count: number | null
  currency: string
  recent: { id: string; amountCents: number; desc: string; created: number }[]
  note: string | null
}

export interface PaySummary {
  stripe: RailSummary
  whop: RailSummary
}

// revenue earned today — the hackathon prize metric
export interface TodayRevenue {
  live: boolean
  mode: 'live' | 'test' | null
  grossCents: number
  netCents: number
  feeCents: number
  refundCents: number
  count: number
  currency: string
  sinceMs: number
  note: string | null
}

export async function fetchStripeToday(): Promise<TodayRevenue | null> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 15000)
  try {
    const res = await fetch('/api/pay/today', { signal: ctl.signal })
    if (!res.ok) return null
    return (await res.json()) as TodayRevenue
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

export async function fetchPaySummary(): Promise<PaySummary | null> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 15000)
  try {
    const res = await fetch('/api/pay/summary', { signal: ctl.signal })
    if (!res.ok) return null
    return (await res.json()) as PaySummary
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}
