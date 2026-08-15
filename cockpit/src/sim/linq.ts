// Thin client for the Business_Agent backend's Linq routes. The integration token
// and phone numbers live in /backend — this file only talks to /api/linq.

export interface LinqSendResult {
  live: boolean
  chatId: string | null
  messageId: string | null
  service: string | null
  deliveryStatus: string | null
  error: string | null
  text?: string | null
}

export interface LinqStatus {
  live: boolean
  paymentLink: string | null
}

const BASE = '/api/linq'

async function api<T>(path: string, init?: RequestInit, timeoutMs = 20000): Promise<T> {
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
    if (!res.ok) throw new Error(json?.error ?? json?.message ?? `Backend ${res.status}`)
    return json as T
  } finally {
    clearTimeout(t)
  }
}

export async function refreshLinqStatus(): Promise<LinqStatus> {
  try {
    const s = await api<LinqStatus>('/status', undefined, 4000)
    return { live: Boolean(s.live), paymentLink: s.paymentLink ?? null }
  } catch {
    return { live: false, paymentLink: null }
  }
}

export async function sendLinqOnboard(): Promise<LinqSendResult> {
  try {
    return await api<LinqSendResult>('/onboard', { method: 'POST' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const down = /failed to fetch|network|abort/i.test(msg)
    return {
      live: false,
      chatId: null,
      messageId: null,
      service: null,
      deliveryStatus: null,
      error: down ? 'Backend not reachable. Run npm run dev in /backend.' : msg.slice(0, 180),
      text: null,
    }
  }
}

export async function sendLinqMessage(text: string): Promise<LinqSendResult> {
  try {
    return await api<LinqSendResult>('/send', { method: 'POST', body: JSON.stringify({ text }) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const down = /failed to fetch|network|abort/i.test(msg)
    return {
      live: false,
      chatId: null,
      messageId: null,
      service: null,
      deliveryStatus: null,
      error: down ? 'Backend not reachable. Run npm run dev in /backend.' : msg.slice(0, 180),
    }
  }
}
