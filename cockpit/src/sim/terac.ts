// Thin client for the Business_Agent backend. Terac keys and the hire live in
// /backend — this file only talks to /api/terac.

export interface TeracReview {
  live: boolean
  jobId: string
  dashboardUrl: string | null
  quote: number | null
  expert: string | null
  title: string
  verdict: 'approved' | 'revised' | 'waiting' | 'error'
  reason: string
}

const BASE = '/api/terac'

async function api<T>(path: string, init?: RequestInit, timeoutMs = 90000): Promise<T> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(BASE + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      signal: ctl.signal,
    })
    const text = await res.text()
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { raw: text }
    }
    if (!res.ok) {
      const err = json?.error
      const msg = typeof err === 'string' ? err : err?.message ?? json?.message ?? `Backend ${res.status}`
      throw new Error(msg)
    }
    return json as T
  } finally {
    clearTimeout(t)
  }
}

export async function refreshTeracStatus(): Promise<boolean> {
  try {
    const s = await api<{ live: boolean }>('/status', undefined, 4000)
    return Boolean(s.live)
  } catch {
    return false
  }
}

export async function hireClaimReview(input: {
  feature: string
  post: string
  voice: string
  clusterTitle: string
}): Promise<TeracReview> {
  try {
    return await api<TeracReview>('/hires', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const down = /failed to fetch|network|abort/i.test(msg)
    return {
      live: false,
      jobId: '',
      dashboardUrl: null,
      quote: null,
      expert: null,
      title: input.clusterTitle,
      verdict: 'error',
      reason: down
        ? 'Backend not reachable. Run npm run dev in /backend.'
        : msg.slice(0, 180),
    }
  }
}

export async function pollClaimReview(jobId: string): Promise<Pick<TeracReview, 'verdict' | 'reason' | 'expert'>> {
  return api(`/hires/${encodeURIComponent(jobId)}`)
}

// ── Trade confidence review (Investment mode) ─────────────────────
export interface TeracTradeReview {
  live: boolean
  jobId: string
  dashboardUrl: string | null
  quote: number | null
  expert: string | null
  confidence: number | null
  status: 'waiting' | 'done' | 'error'
  reason: string
}

export async function hireTradeReview(input: {
  symbol: string
  name: string
  amount: number
  roi: number
  ranking: string
}): Promise<TeracTradeReview> {
  try {
    // the backend retries Terac 429s with backoff — give the hire room
    return await api<TeracTradeReview>(
      '/trades',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      40000,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const down = /failed to fetch|network|abort/i.test(msg)
    return {
      live: false,
      jobId: '',
      dashboardUrl: null,
      quote: null,
      expert: null,
      confidence: null,
      status: 'error',
      reason: down ? 'Backend not reachable. Run npm run dev in /backend.' : msg.slice(0, 180),
    }
  }
}

export async function pollTradeReview(jobId: string): Promise<Pick<TeracTradeReview, 'status' | 'confidence' | 'reason' | 'expert'>> {
  return api(`/trades/${encodeURIComponent(jobId)}`)
}

// ── Ship review (Competition → Product) ─────────────────────────
export interface TeracShipReview {
  live: boolean
  jobId: string
  dashboardUrl: string | null
  quote: number | null
  expert: string | null
  title: string
  verdict: 'approved' | 'rejected' | 'waiting' | 'error'
  reason: string
}

export async function hireShipReview(input: {
  kind: 'verify'
  feature: string
  rival: string
  brief: string
  prTitle?: string
  prNumber?: number
  files?: string
}): Promise<TeracShipReview> {
  try {
    return await api<TeracShipReview>(
      '/ships',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      40000,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const down = /failed to fetch|network|abort/i.test(msg)
    return {
      live: false,
      jobId: '',
      dashboardUrl: null,
      quote: null,
      expert: null,
      title: input.feature,
      verdict: 'error',
      reason: down ? 'Backend not reachable. Run npm run dev in /backend.' : msg.slice(0, 180),
    }
  }
}

export async function pollShipReview(jobId: string): Promise<Pick<TeracShipReview, 'verdict' | 'reason' | 'expert'>> {
  return api(`/ships/${encodeURIComponent(jobId)}`)
}


// ── Treasury allocation review (finance) ─────────────────────────
export interface TeracAllocationReview {
  live: boolean
  jobId: string
  dashboardUrl: string | null
  quote: number | null
  expert: string | null
  verdict: 'approved' | 'adjust' | 'waiting' | 'error'
  reason: string
}

export async function hireAllocationReview(input: {
  bankName: string
  balance: number
  alloc: { label: string; pct: number }[]
  rationale: string
}): Promise<TeracAllocationReview> {
  try {
    return await api<TeracAllocationReview>('/allocations', { method: 'POST', body: JSON.stringify(input) }, 40000)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      live: false,
      jobId: '',
      dashboardUrl: null,
      quote: null,
      expert: null,
      verdict: 'error',
      reason: msg.slice(0, 180),
    }
  }
}

export async function pollAllocationReview(jobId: string): Promise<Pick<TeracAllocationReview, 'verdict' | 'reason' | 'expert'>> {
  return api(`/allocations/${encodeURIComponent(jobId)}`)
}

export async function hireLegalReview(input: {
  bankName: string
  balance: number
  alloc: { label: string; pct: number }[]
  rationale: string
  revenueToday: string
}): Promise<TeracReview> {
  try {
    return await api<TeracReview>('/legal', { method: 'POST', body: JSON.stringify(input) }, 40000)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      live: false,
      jobId: '',
      dashboardUrl: null,
      quote: null,
      expert: null,
      title: 'Legal finances',
      verdict: 'error',
      reason: msg.slice(0, 180),
    }
  }
}

export async function pollLegalReview(jobId: string): Promise<Pick<TeracReview, 'verdict' | 'reason' | 'expert'>> {
  return api(`/legal/${encodeURIComponent(jobId)}`)
}
