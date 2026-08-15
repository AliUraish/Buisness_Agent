// Owns the Terac REST v2 hire. Keys stay here — the frontend never sees them.

import { TERAC_API_KEY } from './env.ts'

const BASE = 'https://terac.com/api/external/v2'

export interface ScreeningAnswer {
  key?: string
  question?: string
  answer?: string | string[]
}

export interface HireInput {
  feature: string
  post: string
  voice: string
  clusterTitle: string
}

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

export function isLive(): boolean {
  return Boolean(TERAC_API_KEY)
}

const RETRYABLE = new Set([429, 502, 503])
let gate: Promise<void> = Promise.resolve()
let projectIdCache: string | null = null

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = gate.then(fn, fn)
  gate = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export class TeracHttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterMs: number | null = null,
  ) {
    super(message)
  }
}

export function formatTeracError(status: number, json: any, text: string): string {
  const nested = json?.error
  const msg =
    (typeof nested === 'string' ? nested : nested?.message) ?? json?.message ?? json?.code ?? text.slice(0, 180)
  const issuesSrc = json?.issues ?? nested?.issues
  const issues = Array.isArray(issuesSrc)
    ? issuesSrc
        .map((i: any) => {
          const path = Array.isArray(i?.path) ? i.path.join('.') : ''
          const m = typeof i === 'string' ? i : i?.message ?? JSON.stringify(i)
          return path ? `${path}: ${m}` : m
        })
        .join('; ')
    : ''
  return `Terac ${status}: ${msg}${issues ? ` — ${issues}` : ''}`
}

function retryAfterMs(res: Response, attempt: number): number {
  const h = res.headers.get('retry-after')
  if (h) {
    const sec = Number(h)
    if (Number.isFinite(sec) && sec >= 0) return Math.min(Math.max(sec, 1) * 1000, 30_000)
    const when = Date.parse(h)
    if (Number.isFinite(when)) return Math.min(Math.max(when - Date.now(), 1000), 30_000)
  }
  return Math.min(2000 * 2 ** attempt, 16_000)
}

async function once(path: string, init: RequestInit | undefined, timeoutMs: number, attempt: number): Promise<any> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(BASE + path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TERAC_API_KEY}`,
        ...(init?.headers ?? {}),
      },
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
      throw new TeracHttpError(res.status, formatTeracError(res.status, json, text), retryAfterMs(res, attempt))
    }
    return json
  } finally {
    clearTimeout(t)
  }
}

async function call(path: string, init?: RequestInit, timeoutMs = 12000): Promise<any> {
  return enqueue(async () => {
    let last: unknown
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await once(path, init, timeoutMs, attempt)
      } catch (e) {
        last = e
        const err = e instanceof TeracHttpError ? e : null
        if (!err || !RETRYABLE.has(err.status) || attempt === 3) throw e
        const wait = err.retryAfterMs ?? Math.min(2000 * 2 ** attempt, 16_000)
        console.warn(`[terac] ${err.status} ${path} — retry ${attempt + 1} in ${wait}ms`)
        await sleep(wait)
      }
    }
    throw last
  })
}

function firstAnswer(a: ScreeningAnswer | undefined): string {
  if (!a) return ''
  if (Array.isArray(a.answer)) return a.answer[0] ?? ''
  return a.answer ?? ''
}

function answersOf(a: ScreeningAnswer | undefined): string[] {
  if (!a) return []
  if (Array.isArray(a.answer)) return a.answer.map(String).filter(Boolean)
  if (a.answer) return [String(a.answer)]
  return []
}

export function parseVerdict(answers: ScreeningAnswer[] | undefined | null): { verdict: 'approved' | 'revised'; reason: string } {
  const list = answers ?? []
  const byKey = (k: string) => list.find((a) => a.key === k)
  const verdictQ = byKey('verdict') ?? list.find((a) => answersOf(a).some((s) => /approve|revise/i.test(s)))
  const parts = answersOf(verdictQ)
  const verdictAns = parts[0] ?? ''
  const notes = firstAnswer(byKey('notes')) || parts.slice(1).join(' ').trim()
  const revised = /revise/i.test(verdictAns)
  return {
    verdict: revised ? 'revised' : 'approved',
    reason: notes || (revised ? 'Expert asked to revise unverifiable claims.' : 'Expert approved the draft as written.'),
  }
}

async function ensureProject(): Promise<string> {
  if (projectIdCache) return projectIdCache
  const listed = await call('/projects?limit=100')
  const rows: { id: string; name: string }[] = listed?.data ?? listed ?? []
  const existing = Array.isArray(rows) ? rows.find((p) => /zeroco/i.test(p.name ?? '')) : undefined
  if (existing?.id) {
    projectIdCache = existing.id
    return existing.id
  }
  const created = await call('/projects', { method: 'POST', body: JSON.stringify({ name: 'ZeroCo' }) })
  if (!created?.id) throw new Error('Terac did not return a project id')
  projectIdCache = created.id
  return created.id
}

export function opportunityBody(projectId: string, input: HireInput) {
  return {
    title: `ZeroCo claim review — ${input.feature}`,
    internal_title: `zeroco-${input.feature.replace(/\s+/g, '-').toLowerCase()}`,
    description:
      `An autonomous company is about to post this to X. You are the only human in the loop.\n\n` +
      `Voice: ${input.voice}. Needed: ${input.clusterTitle}.\n\n` +
      `Post:\n"${input.post}"\n\n` +
      `Approve only if every claim is verifiable (shipped, merged, in production). ` +
      `Revise if it overclaims.`,
    project_id: projectId,
    num_participants: 1,
    business_type: 'b2b',
    unrestricted_audience: true,
    expected_days_to_complete: 5,
    device_types: ['desktop', 'mobile_ios', 'mobile_android'],
    screening_questions: [
      {
        key: 'shipped_review',
        text: 'Have you reviewed product or marketing copy for shipped software in the last 2 years?',
        pick: 'one',
        answers: [
          { text: 'Yes', qualify_logic: 'may' },
          { text: 'No', qualify_logic: 'reject' },
        ],
      },
      {
        key: 'verdict',
        text: `Should ZeroCo publish this post as written?\n\n"${input.post}"`,
        pick: 'one',
        answers: [
          { text: 'Approve — post as written', qualify_logic: 'may', allow_free_text: true },
          { text: 'Revise — claims are too strong', qualify_logic: 'may', allow_free_text: true },
        ],
      },
      {
        key: 'notes',
        text: 'One sentence: why, and what to change if revising.',
        pick: 'one',
        allow_paste: true,
        answers: [
          { text: 'Notes below', qualify_logic: 'may', allow_free_text: true },
          { text: 'No extra notes', qualify_logic: 'may' },
        ],
      },
    ],
    tasks: [
      {
        sequence: 1,
        task_type: 'interview',
        review_type: 'auto_approve',
        title: 'Confirm the verdict',
        description: `Restate Approve or Revise, then one sentence of reasoning.\n\nPost:\n${input.post}`,
        duration_minutes: 15,
        task_url: 'https://terac.com',
      },
    ],
  }
}

export async function hireClaimReview(input: HireInput): Promise<TeracReview> {
  const title = input.clusterTitle
  if (!isLive()) {
    return {
      live: false,
      jobId: '',
      dashboardUrl: null,
      quote: null,
      expert: null,
      title,
      verdict: 'error',
      reason: 'Set TERAC_API_KEY=tk_… in the workspace .env, then restart the backend.',
    }
  }

  let projectId: string
  let created: any
  let launched: any
  try {
    projectId = await ensureProject()
    created = await call('/opportunities', {
      method: 'POST',
      body: JSON.stringify(opportunityBody(projectId, input)),
    })
    const id = created?.id as string | undefined
    if (!id) throw new Error('Terac did not return an opportunity id')
    launched = await call(`/opportunities/${id}/launch`, { method: 'POST', body: JSON.stringify({}) })
    const quoteCents = launched?.pricing?.cost_per_participant_cents ?? created?.pricing?.cost_per_participant_cents
    const quote = Number.isFinite(quoteCents) ? Math.round(Number(quoteCents) / 100) : null
    const dashboardUrl: string | null =
      launched?.links?.dashboard?.study ?? launched?.links?.dashboard_url ?? created?.links?.dashboard?.study ?? null
    return {
      live: true,
      jobId: id,
      dashboardUrl,
      quote,
      expert: null,
      title,
      verdict: 'waiting',
      reason: 'Opportunity live — waiting on a verified Terac expert.',
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const rate = e instanceof TeracHttpError && e.status === 429
    return {
      live: true,
      jobId: '',
      dashboardUrl: null,
      quote: null,
      expert: null,
      title,
      verdict: 'error',
      reason: rate
        ? 'Terac rate-limited this account. Wait about a minute, then press Start again.'
        : msg.slice(0, 180),
    }
  }
}

function hasVerdict(s: any): boolean {
  const answers: ScreeningAnswer[] = s?.screening_answers ?? []
  return answers.some((a) => a.key === 'verdict' || /approve|revise/i.test(firstAnswer(a)))
}

// ── Trade confidence review (Investment mode) ─────────────────────
// The desk is about to deploy treasury into a crypto asset. One human
// expert states how confident they are in the trade — that number rides
// on the fill.

export interface TradeInput {
  symbol: string
  name: string
  amount: number
  roi: number // consensus 30d ROI %
  ranking: string // e.g. "1 BTC +1.1% · 2 DOGE +0.3% · …"
}

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

// bucket midpoints: High 75–100 → 88, Medium 50–75 → 62, Low 25–50 → 38, Very low 0–25 → 12
export function bucketToConfidence(s: string): number | null {
  if (/very\s*low/i.test(s)) return 12
  if (/high/i.test(s)) return 88
  if (/medium/i.test(s)) return 62
  if (/low/i.test(s)) return 38
  return null
}

export function parseConfidence(answers: ScreeningAnswer[] | undefined | null): { confidence: number | null; reason: string } {
  const list = answers ?? []
  const byKey = (k: string) => list.find((a) => a.key === k)
  const confQ = byKey('confidence') ?? list.find((a) => answersOf(a).some((s) => bucketToConfidence(s) != null))
  const parts = answersOf(confQ)
  const confidence = bucketToConfidence(parts[0] ?? '')
  const notes = firstAnswer(byKey('notes')) || parts.slice(1).join(' ').trim()
  return {
    confidence,
    reason: notes || (confidence != null ? 'Expert stated confidence with no extra notes.' : 'No confidence answer found.'),
  }
}

export function tradeOpportunityBody(projectId: string, input: TradeInput) {
  const roiStr = `${input.roi >= 0 ? '+' : ''}${input.roi.toFixed(1)}%`
  return {
    title: `ZeroCo trade review — ${input.symbol}`,
    internal_title: `zeroco-trade-${input.symbol.toLowerCase()}-${Date.now()}`,
    description:
      `An autonomous company's five-agent market desk ranked crypto assets by predicted 30d ROI ` +
      `and wants to deploy $${input.amount} of treasury into ${input.symbol} (${input.name}). ` +
      `You are the only human in the loop.\n\n` +
      `Desk ranking: ${input.ranking}\n` +
      `Consensus 30d ROI for ${input.symbol}: ${roiStr}\n\n` +
      `State how confident you are that this is a reasonable deployment right now. ` +
      `This is a paper-trading account; your confidence number rides on the fill.`,
    project_id: projectId,
    num_participants: 1,
    business_type: 'b2b',
    unrestricted_audience: true,
    expected_days_to_complete: 5,
    device_types: ['desktop', 'mobile_ios', 'mobile_android'],
    screening_questions: [
      {
        key: 'crypto_experience',
        text: 'Have you actively traded or analyzed crypto markets in the last 2 years?',
        pick: 'one',
        answers: [
          { text: 'Yes', qualify_logic: 'may' },
          { text: 'No', qualify_logic: 'reject' },
        ],
      },
      {
        key: 'confidence',
        text:
          `How confident are you that deploying $${input.amount} into ${input.symbol} right now is a reasonable move?\n\n` +
          `Desk consensus 30d ROI: ${roiStr}`,
        pick: 'one',
        answers: [
          { text: 'High (75–100%)', qualify_logic: 'may', allow_free_text: true },
          { text: 'Medium (50–75%)', qualify_logic: 'may', allow_free_text: true },
          { text: 'Low (25–50%)', qualify_logic: 'may', allow_free_text: true },
          { text: 'Very low (0–25%)', qualify_logic: 'may', allow_free_text: true },
        ],
      },
      {
        key: 'notes',
        text: 'One sentence: what drives your confidence level?',
        pick: 'one',
        allow_paste: true,
        answers: [
          { text: 'Notes below', qualify_logic: 'may', allow_free_text: true },
          { text: 'No extra notes', qualify_logic: 'may' },
        ],
      },
    ],
    tasks: [
      {
        sequence: 1,
        task_type: 'interview',
        review_type: 'auto_approve',
        title: 'Confirm your confidence level',
        description: `Restate your confidence bucket for the ${input.symbol} deployment, then one sentence of reasoning.`,
        duration_minutes: 15,
        task_url: 'https://terac.com',
      },
    ],
  }
}

export async function hireTradeReview(input: TradeInput): Promise<TeracTradeReview> {
  if (!isLive()) {
    return {
      live: false,
      jobId: '',
      dashboardUrl: null,
      quote: null,
      expert: null,
      confidence: null,
      status: 'error',
      reason: 'Set TERAC_API_KEY=tk_… in the workspace .env, then restart the backend.',
    }
  }

  try {
    const projectId = await ensureProject()
    const created = await call('/opportunities', {
      method: 'POST',
      body: JSON.stringify(tradeOpportunityBody(projectId, input)),
    })
    const id = created?.id as string | undefined
    if (!id) throw new Error('Terac did not return an opportunity id')

    const launched = await call(`/opportunities/${id}/launch`, { method: 'POST', body: JSON.stringify({}) })
    const quoteCents = launched?.pricing?.cost_per_participant_cents ?? created?.pricing?.cost_per_participant_cents
    const quote = Number.isFinite(quoteCents) ? Math.round(Number(quoteCents) / 100) : null
    const dashboardUrl: string | null =
      launched?.links?.dashboard?.study ?? launched?.links?.dashboard_url ?? created?.links?.dashboard?.study ?? null

    return {
      live: true,
      jobId: id,
      dashboardUrl,
      quote,
      expert: null,
      confidence: null,
      status: 'waiting',
      reason: 'Opportunity live — waiting on a verified Terac expert.',
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const rate = e instanceof TeracHttpError && e.status === 429
    return {
      live: true,
      jobId: '',
      dashboardUrl: null,
      quote: null,
      expert: null,
      confidence: null,
      status: 'error',
      reason: rate
        ? 'Terac rate-limited this account. Wait about a minute, then try again.'
        : msg.slice(0, 180),
    }
  }
}

export async function pollTradeReview(jobId: string): Promise<Pick<TeracTradeReview, 'status' | 'confidence' | 'reason' | 'expert'>> {
  let json: any
  try {
    json = await call(`/opportunities/${encodeURIComponent(jobId)}/submissions?limit=25`)
  } catch (e) {
    if (e instanceof TeracHttpError && RETRYABLE.has(e.status)) {
      return { status: 'waiting', confidence: null, reason: 'Terac is busy — retrying shortly.', expert: null }
    }
    throw e
  }
  const rows: any[] = json?.data ?? []
  const done = rows.find(
    (s) =>
      ['awaiting_review', 'approved', 'screen_passed'].includes(s.status) ||
      (s?.screening_answers ?? []).some((a: ScreeningAnswer) => a.key === 'confidence' || /high|medium|low/i.test(firstAnswer(a))),
  )
  if (!done) return { status: 'waiting', confidence: null, reason: 'Waiting on a Terac expert.', expert: null }

  let answers: ScreeningAnswer[] = done.screening_answers ?? []
  if (done.id) {
    try {
      const detail = await call(`/submissions/${encodeURIComponent(done.id)}`)
      if (detail?.screening_answers) answers = detail.screening_answers
    } catch {
      // list payload is enough to parse confidence
    }
  }
  const parsed = parseConfidence(answers)
  return {
    status: 'done',
    confidence: parsed.confidence,
    reason: parsed.reason,
    expert: done.participant_id ? `expert ${String(done.participant_id).slice(0, 8)}` : 'Terac expert',
  }
}

export async function pollClaimReview(jobId: string): Promise<Pick<TeracReview, 'verdict' | 'reason' | 'expert'>> {
  let json: any
  try {
    json = await call(`/opportunities/${encodeURIComponent(jobId)}/submissions?limit=25`)
  } catch (e) {
    if (e instanceof TeracHttpError && RETRYABLE.has(e.status)) {
      return { verdict: 'waiting', reason: 'Terac is busy — retrying shortly.', expert: null }
    }
    throw e
  }
  const rows: any[] = json?.data ?? []
  const done = rows.find(
    (s) => ['awaiting_review', 'approved', 'screen_passed'].includes(s.status) || hasVerdict(s),
  )
  if (!done) return { verdict: 'waiting', reason: 'Waiting on a Terac expert.', expert: null }

  let answers: ScreeningAnswer[] = done.screening_answers ?? []
  if (done.id) {
    try {
      const detail = await call(`/submissions/${encodeURIComponent(done.id)}`)
      if (detail?.screening_answers) answers = detail.screening_answers
    } catch {
      // list payload is enough to parse a verdict
    }
  }
  const parsed = parseVerdict(answers)
  return {
    verdict: parsed.verdict,
    reason: parsed.reason,
    expert: done.participant_id ? `expert ${String(done.participant_id).slice(0, 8)}` : 'Terac expert',
  }
}

// ── Ship review (Competition → Product) ─────────────────────────
// One hire: a human verifies the research brief AND the agent PR together.
// Approve only if the gap is real and the PR actually covers it.

export interface ShipInput {
  kind: 'verify'
  feature: string
  rival: string
  brief: string
  prTitle?: string
  prNumber?: number
  files?: string
}

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

export function parseShipVerdict(answers: ScreeningAnswer[] | undefined | null): {
  verdict: 'approved' | 'rejected'
  reason: string
} {
  const list = answers ?? []
  const byKey = (k: string) => list.find((a) => a.key === k)
  const verdictQ =
    byKey('verdict') ??
    list.find((a) => answersOf(a).some((s) => /approve|reject|holds/i.test(s)))
  const parts = answersOf(verdictQ)
  const verdictAns = parts[0] ?? ''
  const notes = firstAnswer(byKey('notes')) || parts.slice(1).join(' ').trim()
  const rejected = /reject|does not hold|not ready/i.test(verdictAns)
  return {
    verdict: rejected ? 'rejected' : 'approved',
    reason:
      notes ||
      (rejected
        ? 'Expert rejected — the research or the PR does not hold up.'
        : 'Expert verified research → PR. Agents may merge.'),
  }
}

function hasShipVerdict(s: any): boolean {
  const answers: ScreeningAnswer[] = s?.screening_answers ?? []
  return answers.some((a) => a.key === 'verdict' || /approve|reject|holds|does not hold/i.test(firstAnswer(a)))
}

export function shipOpportunityBody(projectId: string, input: ShipInput) {
  const prLine = `PR #${input.prNumber ?? '?'} — ${input.prTitle ?? input.feature}\nFiles: ${input.files ?? '(see PR)'}`
  return {
    title: `ZeroCo research→PR verify — ${input.feature}`,
    internal_title: `zeroco-verify-${input.feature.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`,
    description:
      `An autonomous company (ZeroCo) researched a rival gap and drafted a pull request. ` +
      `You are the only human in the loop. Verify the research AND the PR together.\n\n` +
      `Rival: ${input.rival}. Feature: ${input.feature}.\n\n` +
      `Research:\n${input.brief}\n\n${prLine}\n\n` +
      `Approve only if (1) the gap is real and worth shipping, and (2) this PR actually covers it. ` +
      `Reject if the research is weak, the PR is vapor, or they do not match.`,
    project_id: projectId,
    num_participants: 1,
    business_type: 'b2b',
    unrestricted_audience: true,
    expected_days_to_complete: 5,
    device_types: ['desktop', 'mobile_ios', 'mobile_android'],
    screening_questions: [
      {
        key: 'experience',
        text: 'Have you reviewed product specs and production PRs in the last 2 years?',
        pick: 'one',
        answers: [
          { text: 'Yes', qualify_logic: 'may' },
          { text: 'No', qualify_logic: 'reject' },
        ],
      },
      {
        key: 'verdict',
        text:
          `Does the research → PR hold up for ${input.feature}?\n\n` +
          `Research: ${input.brief}\n\n${prLine}`,
        pick: 'one',
        answers: [
          { text: 'Approve — research and PR hold up, ship it', qualify_logic: 'may', allow_free_text: true },
          { text: 'Reject — research or PR does not hold', qualify_logic: 'may', allow_free_text: true },
        ],
      },
      {
        key: 'notes',
        text: 'One sentence: why.',
        pick: 'one',
        allow_paste: true,
        answers: [
          { text: 'Notes below', qualify_logic: 'may', allow_free_text: true },
          { text: 'No extra notes', qualify_logic: 'may' },
        ],
      },
    ],
    tasks: [
      {
        sequence: 1,
        task_type: 'interview',
        review_type: 'auto_approve',
        title: 'Confirm research → PR',
        description: `Restate Approve or Reject for ${input.feature} / PR #${input.prNumber ?? '?'}, then one sentence: does the research match the PR?`,
        duration_minutes: 15,
        task_url: 'https://terac.com',
      },
    ],
  }
}

export async function hireShipReview(input: ShipInput): Promise<TeracShipReview> {
  const title = `verify ${input.feature}`
  if (!isLive()) {
    return {
      live: false,
      jobId: '',
      dashboardUrl: null,
      quote: null,
      expert: null,
      title,
      verdict: 'error',
      reason: 'Set TERAC_API_KEY=tk_… in the workspace .env, then restart the backend.',
    }
  }

  try {
    const projectId = await ensureProject()
    const created = await call('/opportunities', {
      method: 'POST',
      body: JSON.stringify(shipOpportunityBody(projectId, input)),
    })
    const id = created?.id as string | undefined
    if (!id) throw new Error('Terac did not return an opportunity id')
    const launched = await call(`/opportunities/${id}/launch`, { method: 'POST', body: JSON.stringify({}) })
    const quoteCents = launched?.pricing?.cost_per_participant_cents ?? created?.pricing?.cost_per_participant_cents
    const quote = Number.isFinite(quoteCents) ? Math.round(Number(quoteCents) / 100) : null
    const dashboardUrl: string | null =
      launched?.links?.dashboard?.study ?? launched?.links?.dashboard_url ?? created?.links?.dashboard?.study ?? null
    return {
      live: true,
      jobId: id,
      dashboardUrl,
      quote,
      expert: null,
      title,
      verdict: 'waiting',
      reason: 'Opportunity live — waiting on a verified Terac expert.',
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const rate = e instanceof TeracHttpError && e.status === 429
    return {
      live: true,
      jobId: '',
      dashboardUrl: null,
      quote: null,
      expert: null,
      title,
      verdict: 'error',
      reason: rate
        ? 'Terac rate-limited this account. Wait about a minute, then the desk will retry.'
        : msg.slice(0, 180),
    }
  }
}

export async function pollShipReview(jobId: string): Promise<Pick<TeracShipReview, 'verdict' | 'reason' | 'expert'>> {
  let json: any
  try {
    json = await call(`/opportunities/${encodeURIComponent(jobId)}/submissions?limit=25`)
  } catch (e) {
    if (e instanceof TeracHttpError && RETRYABLE.has(e.status)) {
      return { verdict: 'waiting', reason: 'Terac is busy — retrying shortly.', expert: null }
    }
    throw e
  }
  const rows: any[] = json?.data ?? []
  const done = rows.find(
    (s) => ['awaiting_review', 'approved', 'screen_passed'].includes(s.status) || hasShipVerdict(s),
  )
  if (!done) return { verdict: 'waiting', reason: 'Waiting on a Terac expert.', expert: null }

  let answers: ScreeningAnswer[] = done.screening_answers ?? []
  if (done.id) {
    try {
      const detail = await call(`/submissions/${encodeURIComponent(done.id)}`)
      if (detail?.screening_answers) answers = detail.screening_answers
    } catch {
      // list payload is enough to parse a verdict
    }
  }
  const parsed = parseShipVerdict(answers)
  return {
    verdict: parsed.verdict,
    reason: parsed.reason,
    expert: done.participant_id ? `expert ${String(done.participant_id).slice(0, 8)}` : 'Terac expert',
  }
}
