// The agents' actual brains: Anthropic / OpenAI / Gemini completions,
// proxied so keys never reach the browser. Hard spend rails:
// - per-call output tokens capped at MAX_TOKENS
// - per-session call count capped at MAX_CALLS (resets on backend restart)
// - cheap-tier models by default; cost estimated per call and totaled

import { ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY } from './env.ts'

export type Provider = 'anthropic' | 'openai' | 'gemini'
export type Tier = 'cheap' | 'smart'

const MAX_TOKENS = 350
const MAX_CALLS = 250

// [model, $ per MTok in, $ per MTok out] — estimates for cost display
const MODELS: Record<Provider, Record<Tier, [string, number, number]>> = {
  anthropic: {
    cheap: ['claude-haiku-4-5-20251001', 1.0, 5.0],
    smart: ['claude-sonnet-5', 3.0, 15.0],
  },
  openai: {
    cheap: ['gpt-5-mini', 0.25, 2.0],
    smart: ['gpt-5', 1.25, 10.0],
  },
  gemini: {
    cheap: ['gemini-2.5-flash', 0.3, 2.5],
    smart: ['gemini-2.5-pro', 1.25, 10.0],
  },
}

const FALLBACK_MODEL: Record<Provider, string> = {
  anthropic: 'claude-3-5-haiku-latest',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-1.5-flash',
}

let callsUsed = 0
let spentUsd = 0

export interface LlmResult {
  live: boolean
  provider: Provider
  model: string
  text: string
  tokensIn: number
  tokensOut: number
  costUsd: number // estimated
  callsUsed: number
  error: string | null
}

export function llmStatus() {
  return {
    anthropic: Boolean(ANTHROPIC_API_KEY),
    openai: Boolean(OPENAI_API_KEY),
    gemini: Boolean(GEMINI_API_KEY),
    callsUsed,
    callsMax: MAX_CALLS,
    spentUsd: Number(spentUsd.toFixed(4)),
  }
}

function keyFor(p: Provider): string {
  return p === 'anthropic' ? ANTHROPIC_API_KEY : p === 'openai' ? OPENAI_API_KEY : GEMINI_API_KEY
}

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs = 25000): Promise<any> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctl.signal,
    })
    const raw = await res.text()
    let json: any = null
    try {
      json = raw ? JSON.parse(raw) : null
    } catch {
      json = { raw }
    }
    if (!res.ok) {
      const msg = json?.error?.message ?? json?.message ?? raw.slice(0, 160)
      const err: any = new Error(`${res.status}: ${msg}`)
      err.status = res.status
      throw err
    }
    return json
  } finally {
    clearTimeout(t)
  }
}

async function callProvider(
  provider: Provider,
  model: string,
  system: string,
  prompt: string,
  maxTokens: number,
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  if (provider === 'anthropic') {
    const json = await post(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': keyFor(provider), 'anthropic-version': '2023-06-01' },
      { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] },
    )
    return {
      text: (json?.content ?? []).map((c: any) => c?.text ?? '').join(''),
      tokensIn: json?.usage?.input_tokens ?? 0,
      tokensOut: json?.usage?.output_tokens ?? 0,
    }
  }
  if (provider === 'openai') {
    const body: any = {
      model,
      max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }
    // gpt-5 family reasons by default and can burn the whole budget thinking
    if (/^gpt-5/.test(model)) body.reasoning_effort = 'minimal'
    const json = await post('https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${keyFor(provider)}` }, body)
    return {
      text: json?.choices?.[0]?.message?.content ?? '',
      tokensIn: json?.usage?.prompt_tokens ?? 0,
      tokensOut: json?.usage?.completion_tokens ?? 0,
    }
  }
  // gemini
  const json = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keyFor(provider)}`,
    {},
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: prompt }] }],
      // 2.5 models think by default; thoughts consume the output budget
      generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } },
    },
  )
  return {
    text: (json?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join(''),
    tokensIn: json?.usageMetadata?.promptTokenCount ?? 0,
    tokensOut: json?.usageMetadata?.candidatesTokenCount ?? 0,
  }
}

export async function complete(input: {
  provider: Provider
  tier?: Tier
  system: string
  prompt: string
  maxTokens?: number
}): Promise<LlmResult> {
  const provider = input.provider
  const tier: Tier = input.tier === 'smart' ? 'smart' : 'cheap'
  const [model, inRate, outRate] = MODELS[provider][tier]
  const base: LlmResult = {
    live: false,
    provider,
    model,
    text: '',
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    callsUsed,
    error: null,
  }
  if (!keyFor(provider)) return { ...base, error: `${provider} key not configured` }
  if (callsUsed >= MAX_CALLS) return { ...base, error: `session call cap reached (${MAX_CALLS}) — restart the backend to reset` }

  const maxTokens = Math.min(Math.max(input.maxTokens ?? 200, 16), MAX_TOKENS)
  callsUsed++
  try {
    let usedModel = model
    let out: { text: string; tokensIn: number; tokensOut: number }
    try {
      out = await callProvider(provider, model, input.system, input.prompt, maxTokens)
    } catch (e: any) {
      // unknown-model errors fall back once to a widely available model
      const msg = String(e?.message ?? '')
      if (e?.status === 404 || /model|not.?found|does not exist|invalid/i.test(msg)) {
        usedModel = FALLBACK_MODEL[provider]
        out = await callProvider(provider, usedModel, input.system, input.prompt, maxTokens)
      } else {
        throw e
      }
    }
    const costUsd = (out.tokensIn * inRate + out.tokensOut * outRate) / 1_000_000
    spentUsd += costUsd
    return {
      ...base,
      live: true,
      model: usedModel,
      text: out.text,
      tokensIn: out.tokensIn,
      tokensOut: out.tokensOut,
      costUsd: Number(costUsd.toFixed(6)),
      callsUsed,
    }
  } catch (e) {
    return { ...base, error: (e instanceof Error ? e.message : String(e)).slice(0, 200), callsUsed }
  }
}
