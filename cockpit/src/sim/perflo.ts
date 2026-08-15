// Client for the backend's Perflo reads (the agent bank).
export interface PerfloSummary {
  live: boolean
  balance: number | null
  available: number | null
  currency: string
  recent: { kind: string; amount: number; at: string }[]
  note: string | null
}

export async function fetchPerfloSummary(): Promise<PerfloSummary | null> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 15000)
  try {
    const res = await fetch('/api/perflo/summary', { signal: ctl.signal })
    if (!res.ok) return null
    return (await res.json()) as PerfloSummary
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}
