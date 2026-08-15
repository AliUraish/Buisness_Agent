// Client for the backend LLM proxy — the agents' real brains.
// The backend enforces the spend rails (per-call token cap, session call cap).

export type LlmProvider = 'anthropic' | 'openai' | 'gemini'

export interface LlmStatus {
  anthropic: boolean
  openai: boolean
  gemini: boolean
  callsUsed: number
  callsMax: number
  spentUsd: number
}

export interface LlmResult {
  live: boolean
  provider: LlmProvider
  model: string
  text: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  callsUsed: number
  error: string | null
}

export async function fetchLlmStatus(): Promise<LlmStatus | null> {
  try {
    const res = await fetch('/api/llm/status')
    if (!res.ok) return null
    return (await res.json()) as LlmStatus
  } catch {
    return null
  }
}

export async function llmComplete(input: {
  provider: LlmProvider
  tier?: 'cheap' | 'smart'
  system: string
  prompt: string
  maxTokens?: number
}): Promise<LlmResult | null> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 30000)
  try {
    const res = await fetch('/api/llm/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: ctl.signal,
    })
    if (!res.ok) return null
    return (await res.json()) as LlmResult
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

// pull the first JSON object out of a model reply (handles code fences)
export function extractJson(text: string): any | null {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0])
  } catch {
    return null
  }
}
