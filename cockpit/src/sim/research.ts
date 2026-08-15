// Client for the backend's Perplexity research (competition desk).
export interface ResearchResult {
  live: boolean
  text: string
  citations: string[]
  callsUsed: number
  error: string | null
}

export async function fetchResearchStatus(): Promise<{ live: boolean } | null> {
  try {
    const res = await fetch('/api/research/status')
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function runResearch(query: string, system: string): Promise<ResearchResult | null> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 35000)
  try {
    const res = await fetch('/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, system }),
      signal: ctl.signal,
    })
    if (!res.ok) return null
    return (await res.json()) as ResearchResult
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}
