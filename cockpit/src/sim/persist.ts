// Client for the backend's Neon persistence: the append-only event
// journal and the key/value state snapshots. All fire-and-forget safe —
// the cockpit runs identically if the database is unreachable.

export interface DbStatus {
  live: boolean
  error: string | null
  events: number
}

async function req(path: string, init?: RequestInit, timeoutMs = 12000): Promise<any | null> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      signal: ctl.signal,
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

export async function fetchDbStatus(): Promise<DbStatus | null> {
  return req('/api/db/status')
}

export function journalEvent(ev: { dept: string; agent: string; message: string; chips?: string[]; delta?: string }): void {
  void req('/api/db/events', { method: 'POST', body: JSON.stringify(ev) })
}

export async function loadJournal(limit = 80): Promise<any[]> {
  return (await req(`/api/db/events?limit=${limit}`)) ?? []
}

export function putState(key: string, value: unknown): void {
  void req('/api/db/state', { method: 'PUT', body: JSON.stringify({ key, value }) })
}

export async function loadState(): Promise<Record<string, any>> {
  return (await req('/api/db/state')) ?? {}
}
