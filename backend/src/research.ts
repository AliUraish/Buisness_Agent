// Real competitive research via Perplexity (sonar, web-grounded).
// Budget rails: bounded output, hard session call cap.
import { PERPLEXITY_API_KEY } from './env.ts'

const MAX_CALLS = 12
let callsUsed = 0

export interface ResearchResult {
  live: boolean
  text: string
  citations: string[]
  callsUsed: number
  error: string | null
}

export function researchStatus() {
  return { live: Boolean(PERPLEXITY_API_KEY), callsUsed, callsMax: MAX_CALLS }
}

export async function research(query: string, system: string): Promise<ResearchResult> {
  const base: ResearchResult = { live: false, text: '', citations: [], callsUsed, error: null }
  if (!PERPLEXITY_API_KEY) return { ...base, error: 'Set PERPLEXITY_API_KEY in the workspace .env.' }
  if (callsUsed >= MAX_CALLS) return { ...base, error: `research call cap reached (${MAX_CALLS})` }
  callsUsed++
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 30000)
  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PERPLEXITY_API_KEY}` },
      signal: ctl.signal,
      body: JSON.stringify({
        model: 'sonar',
        max_tokens: 350,
        messages: [
          { role: 'system', content: system.slice(0, 1000) },
          { role: 'user', content: query.slice(0, 1500) },
        ],
      }),
    })
    const raw = await res.text()
    let json: any = null
    try {
      json = raw ? JSON.parse(raw) : null
    } catch {
      json = { raw }
    }
    if (!res.ok) {
      return { ...base, callsUsed, error: `Perplexity ${res.status}: ${(json?.error?.message ?? raw).toString().slice(0, 140)}` }
    }
    const cites: string[] = (json?.citations ?? json?.search_results?.map((r: any) => r?.url) ?? []).filter(Boolean).slice(0, 6)
    return {
      live: true,
      text: json?.choices?.[0]?.message?.content ?? '',
      citations: cites.map((u: string) => String(u)),
      callsUsed,
      error: null,
    }
  } catch (e) {
    return { ...base, callsUsed, error: (e instanceof Error ? e.message : String(e)).slice(0, 140) }
  } finally {
    clearTimeout(t)
  }
}
