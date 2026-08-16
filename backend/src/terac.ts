// Owns the Terac REST v2 hire. Keys stay here — the frontend never sees them.

import { GITHUB_REPO, REVIEW_URL, STRIPE_PAYMENT_LINK, TERAC_API_KEY } from './env.ts'
import { mcpListSubmissions } from './terac-mcp.ts'

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
  const revised = /revise|no —|too expensive|maybe/i.test(verdictAns)
  return {
    verdict: revised ? 'revised' : 'approved',
    reason: notes || (revised ? 'Expert asked for a revision.' : 'Expert approved the post.'),
  }
}

async function ensureProject(): Promise<string> {
  if (projectIdCache) return projectIdCache
  const listed = await call('/projects?limit=100')
  const rows: { id: string; name: string }[] = listed?.data ?? listed ?? []
  const existing = Array.isArray(rows) ? rows.find((p) => /business_agent|bob the busines/i.test(p.name ?? '')) : undefined
  if (existing?.id) {
    projectIdCache = existing.id
    return existing.id
  }
  const created = await call('/projects', { method: 'POST', body: JSON.stringify({ name: 'Bob the Busines' }) })
  if (!created?.id) throw new Error('Terac did not return a project id')
  projectIdCache = created.id
  return created.id
}

/** Cheapest legal 1-person hire: general pop, no AI interview, 5-minute activity. */
export const CHEAP_HIRE = {
  num_participants: 1,
  business_type: 'b2c' as const,
  unrestricted_audience: true,
  expected_days_to_complete: 5,
  device_types: ['desktop', 'mobile_ios', 'mobile_android'],
}

export const TASK_MINUTES = 5

export function reviewPageUrl(params: Record<string, string | number | undefined | null> = {}): string {
  const base = REVIEW_URL || 'http://127.0.0.1:8787/review'
  const u = new URL(base)
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue
    u.searchParams.set(k, String(v).slice(0, 400))
  }
  if (params.mode !== 'ship' && STRIPE_PAYMENT_LINK && !u.searchParams.has('link')) {
    u.searchParams.set('link', STRIPE_PAYMENT_LINK)
  }
  return u.toString()
}

/** Open-ended notes — Terac `pick: text` is the real written form, not a fake radio. */
export function notesQuestion(text = 'One sentence: why.') {
  return {
    key: 'notes',
    text,
    pick: 'text' as const,
    allow_paste: true,
  }
}

export function cheapActivity(title: string, description: string, url: string) {
  return {
    sequence: 1,
    task_type: 'activity',
    review_type: 'auto_approve',
    title,
    description,
    duration_minutes: TASK_MINUTES,
    task_url: url,
  }
}

export function opportunityBody(projectId: string, input: HireInput) {
  const page = reviewPageUrl({ mode: 'claim', feature: input.feature, post: input.post })
  return {
    title: `Review this post — ${input.feature}`,
    internal_title: `business-agent-${input.feature.replace(/\s+/g, '-').toLowerCase()}`,
    description:
      `You are the ONE human reviewing an agent-written post. ~5 minutes.\n\n` +
      `Feature: ${input.feature}\n\n${input.post}\n\n` +
      `Open the task page, then Approve or Revise.\n${page}`,
    project_id: projectId,
    ...CHEAP_HIRE,
    screening_questions: [
      {
        key: 'verdict',
        text: `Should we post this as written? (${input.feature})`,
        pick: 'one',
        answers: [
          { text: 'Approve — post as written', qualify_logic: 'may', allow_free_text: true },
          { text: 'Revise — claims are too strong', qualify_logic: 'may', allow_free_text: true },
        ],
      },
      notesQuestion('One sentence: why approve or revise?'),
    ],
    tasks: [
      cheapActivity(
        'Read the post, then answer',
        `Open the briefing, read the post, then Approve or Revise.\n\n${page}`,
        page,
      ),
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
  const page = reviewPageUrl({ mode: 'trade', feature: `${input.symbol} $${input.amount}`, post: `Deploy $${input.amount} into ${input.symbol}. Desk 30d ROI ${roiStr}. ${input.ranking}` })
  return {
    title: `Bob the Busines trade review — ${input.symbol}`,
    internal_title: `business-agent-trade-${input.symbol.toLowerCase()}-${Date.now()}`,
    description:
      `ONE human, ~5 minutes. An agent-run company just took Stripe subscription cash and wants to deploy $${input.amount} into ${input.symbol} (${input.name}).\n\n` +
      `Desk ranking: ${input.ranking}\nConsensus 30d ROI: ${roiStr}\n\n` +
      `Open the task page, then state confidence.\n${page}`,
    project_id: projectId,
    ...CHEAP_HIRE,
    screening_questions: [
      {
        key: 'crypto_experience',
        text: 'Have you looked at a crypto price in the last year?',
        pick: 'one',
        answers: [
          { text: 'Yes', qualify_logic: 'may' },
          { text: 'No', qualify_logic: 'may' },
        ],
      },
      {
        key: 'confidence',
        text:
          `How confident are you that deploying $${input.amount} into ${input.symbol} right now is a reasonable move?\n\n` +
          `Desk consensus 30d ROI: ${roiStr}`,
        question_rich_text:
          `How confident are you deploying **$${input.amount}** into **${input.symbol}**?\n\nDesk ranking: ${input.ranking}\nConsensus 30d ROI: ${roiStr}`,
        pick: 'one',
        answers: [
          { text: 'High (75–100%)', qualify_logic: 'may', allow_free_text: true },
          { text: 'Medium (50–75%)', qualify_logic: 'may', allow_free_text: true },
          { text: 'Low (25–50%)', qualify_logic: 'may', allow_free_text: true },
          { text: 'Very low (0–25%)', qualify_logic: 'may', allow_free_text: true },
        ],
      },
      notesQuestion('One sentence: what drives your confidence level?'),
    ],
    tasks: [
      cheapActivity(
        'Open the deploy brief',
        `Look at the desk deploying $${input.amount} into ${input.symbol}, then answer confidence.`,
        page,
      ),
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

async function listSubmissions(jobId: string): Promise<any[]> {
  const mcpRows = await mcpListSubmissions(jobId)
  try {
    const json = await call(`/opportunities/${encodeURIComponent(jobId)}/submissions?limit=25`)
    const rest = json?.data ?? []
    if (mcpRows && mcpRows.length) return mcpRows
    return rest
  } catch (e) {
    if (mcpRows) return mcpRows
    throw e
  }
}

export async function pollTradeReview(jobId: string): Promise<Pick<TeracTradeReview, 'status' | 'confidence' | 'reason' | 'expert'>> {
  let rows: any[]
  try {
    rows = await listSubmissions(jobId)
  } catch (e) {
    if (e instanceof TeracHttpError && RETRYABLE.has(e.status)) {
      return { status: 'waiting', confidence: null, reason: 'Terac is busy — retrying shortly.', expert: null }
    }
    throw e
  }
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
  let rows: any[]
  try {
    rows = await listSubmissions(jobId)
  } catch (e) {
    if (e instanceof TeracHttpError && RETRYABLE.has(e.status)) {
      return { verdict: 'waiting', reason: 'Terac is busy — retrying shortly.', expert: null }
    }
    throw e
  }
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
  const shipAns = firstAnswer(byKey('ship')) || firstAnswer(byKey('verdict')) || ''
  const codeAns = firstAnswer(byKey('code'))
  const notes =
    firstAnswer(byKey('notes')) ||
    answersOf(byKey('ship')).slice(1).join(' ').trim() ||
    answersOf(byKey('verdict')).slice(1).join(' ').trim()
  const shipYes = /yes — ship|approve/i.test(shipAns)
  const noShip = /no —|do not ship|don't ship|reject|does not hold/i.test(shipAns)
  const codeReady = /ready to merge|perfect/i.test(codeAns)
  const notReady = /not perfect|needs work|not ready/i.test(codeAns)
  const askedShip = Boolean(byKey('ship'))
  const rejected = askedShip
    ? noShip || !shipYes || notReady || !codeReady
    : noShip || !/approve/i.test(shipAns)
  return {
    verdict: rejected ? 'rejected' : 'approved',
    reason:
      notes ||
      (noShip
        ? 'Human said do not ship.'
        : notReady
          ? 'Human would ship the idea but the code is not ready.'
          : 'Human approved ship — code is ready.'),
  }
}

function hasShipVerdict(s: any): boolean {
  const answers: ScreeningAnswer[] = s?.screening_answers ?? []
  return answers.some(
    (a) =>
      a.key === 'ship' ||
      a.key === 'verdict' ||
      /yes — ship|do not ship|approve|reject|holds|does not hold/i.test(firstAnswer(a)),
  )
}

export interface AllocationInput {
  bankName: string
  balance: number
  alloc: { label: string; pct: number }[]
  rationale: string
}

export interface TeracAllocationReview {
  live: boolean
  jobId: string
  dashboardUrl: string | null
  quote: number | null
  expert: string | null
  verdict: 'approved' | 'adjust' | 'waiting' | 'error'
  reason: string
}

export function allocationOpportunityBody(projectId: string, input: AllocationInput) {
  const rows = input.alloc
    .map((a) => `  ${a.label}: ${a.pct}%  (~$${Math.round((input.balance * a.pct) / 100).toLocaleString()})`)
    .join('\n')
  const page = reviewPageUrl({
    mode: 'alloc',
    feature: input.bankName,
    post: `${input.bankName}: $${input.balance.toLocaleString()}\n${rows}\n${input.rationale}`,
  })
  return {
    title: `Bob the Busines treasury review — $${input.balance.toLocaleString()}`,
    internal_title: `business-agent-alloc-${Date.now()}`,
    description:
      `ONE human, ~5 minutes. Bob the Busines CFO Agent divided the operating account.\n\n` +
      `== ACCOUNT ==\n${input.bankName}: $${input.balance.toLocaleString()}\n\n` +
      `== PROPOSED DIVISION ==\n${rows}\n\n` +
      `== CFO REASONING ==\n${input.rationale}\n\n` +
      `Open the task page, then Approve or Adjust.\n${page}`,
    project_id: projectId,
    ...CHEAP_HIRE,
    screening_questions: [
      {
        key: 'finance_experience',
        text: 'Have you seen a household or business budget in the last year?',
        pick: 'one',
        answers: [
          { text: 'Yes', qualify_logic: 'may' },
          { text: 'No', qualify_logic: 'may' },
        ],
      },
      {
        key: 'verdict',
        text: 'Your verdict on the CFO\'s division:',
        pick: 'one',
        answers: [
          { text: 'Approve — sensible division', qualify_logic: 'may', allow_free_text: true },
          { text: 'Adjust — something is off (say what)', qualify_logic: 'may', allow_free_text: true },
        ],
      },
      notesQuestion('One sentence: why, and what to change if adjusting.'),
    ],
    tasks: [cheapActivity('Open the treasury brief', 'Look at the split, then Approve or Adjust.', page)],
  }
}

export async function hireAllocationReview(input: AllocationInput): Promise<TeracAllocationReview> {
  if (!isLive()) {
    return { live: false, jobId: '', dashboardUrl: null, quote: null, expert: null, verdict: 'error', reason: 'Set TERAC_API_KEY in the workspace .env.' }
  }
  const projectId = await ensureProject()
  const created = await call('/opportunities', { method: 'POST', body: JSON.stringify(allocationOpportunityBody(projectId, input)) })
  const id = created?.id as string | undefined
  if (!id) throw new Error('Terac did not return an opportunity id')
  const launched = await call(`/opportunities/${id}/launch`, { method: 'POST', body: JSON.stringify({}) })
  const quoteCents = launched?.pricing?.cost_per_participant_cents ?? created?.pricing?.cost_per_participant_cents
  return {
    live: true,
    jobId: id,
    dashboardUrl: launched?.links?.dashboard?.study ?? created?.links?.dashboard?.study ?? null,
    quote: Number.isFinite(quoteCents) ? Math.round(Number(quoteCents) / 100) : null,
    expert: null,
    verdict: 'waiting',
    reason: 'Opportunity live — waiting on a human to review the division.',
  }
}

export async function pollAllocationReview(jobId: string): Promise<Pick<TeracAllocationReview, 'verdict' | 'reason' | 'expert'>> {
  const rows: any[] = await listSubmissions(jobId)
  const done = rows.find((r) => ['awaiting_review', 'approved', 'screen_passed'].includes(r.status) || (r?.screening_answers ?? []).some((a: ScreeningAnswer) => a.key === 'verdict'))
  if (!done) return { verdict: 'waiting', reason: 'Waiting on a human reviewer.', expert: null }
  let answers: ScreeningAnswer[] = done.screening_answers ?? []
  if (done.id) {
    try {
      const detail = await call(`/submissions/${encodeURIComponent(done.id)}`)
      if (detail?.screening_answers) answers = detail.screening_answers
    } catch {
      // list payload is enough
    }
  }
  const byKey = (k: string) => answers.find((a) => a.key === k)
  const v = firstAnswer(byKey('verdict'))
  const notes = firstAnswer(byKey('notes'))
  const adjust = /adjust/i.test(v)
  return {
    verdict: adjust ? 'adjust' : 'approved',
    reason: notes || (adjust ? 'Human flagged the division for adjustment.' : 'Human approved the division as sensible.'),
    expert: done.participant_id ? `expert ${String(done.participant_id).slice(0, 8)}` : 'Terac expert',
  }
}

export interface LegalInput {
  bankName: string
  balance: number
  alloc: { label: string; pct: number }[]
  rationale: string
  revenueToday: string
}

export interface TeracLegalReview {
  live: boolean
  jobId: string
  dashboardUrl: string | null
  quote: number | null
  expert: string | null
  title: string
  verdict: 'approved' | 'revised' | 'waiting' | 'error'
  reason: string
}

export function legalPageUrl(): string {
  const review = REVIEW_URL || 'http://127.0.0.1:8787/review'
  try {
    const u = new URL(review)
    u.pathname = '/legal'
    u.search = ''
    return u.toString()
  } catch {
    return 'http://127.0.0.1:8787/legal'
  }
}

export function legalOpportunityBody(projectId: string, input: LegalInput) {
  const rows = input.alloc
    .map((a) => `  ${a.label}: ${a.pct}%  (~$${Math.round((input.balance * a.pct) / 100).toLocaleString()})`)
    .join('\n')
  const page = legalPageUrl()
  return {
    title: `Legal finances — Bob the Busines`,
    internal_title: `business-agent-legal-${Date.now()}`,
    description:
      `ONE human, ~5 minutes. Review whether Bob the Busines legal finances are in order.\n\n` +
      `== ACCOUNT ==\n${input.bankName}: $${input.balance.toLocaleString()}\nRevenue today: ${input.revenueToday}\n\n` +
      `== DIVISION ==\n${rows}\n\n` +
      `== CFO ==\n${input.rationale}\n\n` +
      `Open the legal-finances page, then Approve or Flag.\n${page}`,
    project_id: projectId,
    ...CHEAP_HIRE,
    screening_questions: [
      {
        key: 'verdict',
        text: 'Are the legal finances in order? (books, Stripe, allocation, tax reserve)',
        pick: 'one',
        answers: [
          { text: 'Approve — legal finances look in order', qualify_logic: 'may', allow_free_text: true },
          { text: 'Flag — legal or finance issue (say what)', qualify_logic: 'may', allow_free_text: true },
        ],
      },
      notesQuestion('One sentence: why, and what to fix if flagging.'),
    ],
    tasks: [cheapActivity('Open legal finances', 'Read the page, then Approve or Flag.', page)],
  }
}

export function parseLegalVerdict(answers: ScreeningAnswer[] | undefined | null): {
  verdict: 'approved' | 'revised'
  reason: string
} {
  const list = answers ?? []
  const byKey = (k: string) => list.find((a) => a.key === k)
  const v = firstAnswer(byKey('verdict'))
  const notes = firstAnswer(byKey('notes')) || answersOf(byKey('verdict')).slice(1).join(' ').trim()
  const flagged = /flag|issue|adjust|revise/i.test(v)
  return {
    verdict: flagged ? 'revised' : 'approved',
    reason: notes || (flagged ? 'Human flagged a legal or finance issue.' : 'Human approved legal finances.'),
  }
}

export async function hireLegalReview(input: LegalInput): Promise<TeracLegalReview> {
  if (!isLive()) {
    return {
      live: false,
      jobId: '',
      dashboardUrl: null,
      quote: null,
      expert: null,
      title: 'Legal finances',
      verdict: 'error',
      reason: 'Set TERAC_API_KEY in the workspace .env, then restart the backend.',
    }
  }
  try {
    const projectId = await ensureProject()
    const created = await call('/opportunities', { method: 'POST', body: JSON.stringify(legalOpportunityBody(projectId, input)) })
    const id = created?.id as string | undefined
    if (!id) throw new Error('Terac did not return an opportunity id')
    const launched = await call(`/opportunities/${id}/launch`, { method: 'POST', body: JSON.stringify({}) })
    const quoteCents = launched?.pricing?.cost_per_participant_cents ?? created?.pricing?.cost_per_participant_cents
    return {
      live: true,
      jobId: id,
      dashboardUrl: launched?.links?.dashboard?.study ?? created?.links?.dashboard?.study ?? null,
      quote: Number.isFinite(quoteCents) ? Math.round(Number(quoteCents) / 100) : null,
      expert: null,
      title: 'Legal finances',
      verdict: 'waiting',
      reason: 'Opportunity live — waiting on a human for legal finances.',
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      live: true,
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

export async function pollLegalReview(jobId: string): Promise<Pick<TeracLegalReview, 'verdict' | 'reason' | 'expert'>> {
  const rows: any[] = await listSubmissions(jobId)
  const done = rows.find(
    (r) => ['awaiting_review', 'approved', 'screen_passed'].includes(r.status) || (r?.screening_answers ?? []).some((a: ScreeningAnswer) => a.key === 'verdict'),
  )
  if (!done) return { verdict: 'waiting', reason: 'Waiting on a human reviewer.', expert: null }
  let answers: ScreeningAnswer[] = done.screening_answers ?? []
  if (done.id) {
    try {
      const detail = await call(`/submissions/${encodeURIComponent(done.id)}`)
      if (detail?.screening_answers) answers = detail.screening_answers
    } catch {
      // list payload is enough
    }
  }
  const parsed = parseLegalVerdict(answers)
  return {
    verdict: parsed.verdict,
    reason: parsed.reason,
    expert: done.participant_id ? `expert ${String(done.participant_id).slice(0, 8)}` : 'Terac expert',
  }
}

export function shipOpportunityBody(projectId: string, input: ShipInput) {
  const repo = GITHUB_REPO || ''
  const prUrl = input.prNumber ? `https://github.com/${repo}/pull/${input.prNumber}` : `https://github.com/${repo}`
  const page = reviewPageUrl({
    mode: 'ship',
    feature: input.feature,
    pr: input.prNumber,
    prTitle: input.prTitle,
    files: input.files,
    repo,
    brief: input.brief,
    rival: input.rival,
    prUrl,
  })
  const shipYes = 'Yes — ship it'
  return {
    title: `Ship review — ${input.feature}`,
    internal_title: `business-agent-verify-${input.feature.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`,
    description:
      `You are a human in the ship loop. Agents opened this change. ~5 minutes.\n\n` +
      `Feature: ${input.feature}${input.prTitle ? ` — ${input.prTitle}` : ''}\n` +
      `Rival context: ${input.rival}\n${input.brief}\n\n` +
      `PR: ${prUrl}\nRepo: https://github.com/${repo}\nFiles: ${input.files ?? '(in the PR)'}\n\n` +
      `1. Open the form (and the PR).\n2. Should we ship?\n3. If yes — is the code ready?\n\n${page}`,
    project_id: projectId,
    ...CHEAP_HIRE,
    screening_questions: [
      {
        key: 'ship',
        text: `Should we ship "${input.feature}"? Open the PR first: ${prUrl}`,
        question_rich_text: `Should we ship **${input.feature}**?\n\n1. [Open the PR](${prUrl})\n2. [Open the repo](https://github.com/${repo})\n3. Then answer below.`,
        pick: 'one',
        answers: [
          { text: shipYes, qualify_logic: 'may', allow_free_text: true },
          { text: 'No — do not ship', qualify_logic: 'may', allow_free_text: true },
        ],
      },
      {
        key: 'code',
        text: `You said ship. Open the repo and the PR. Is the code ready to merge?\nRepo: https://github.com/${repo}\nPR: ${prUrl}`,
        pick: 'one',
        display_condition: {
          conditions: [{ screening_question: 'ship', answer: shipYes, operator: 'eq' }],
          join: 'and',
        },
        answers: [
          { text: 'Yes — code is ready to merge', qualify_logic: 'may', allow_free_text: true },
          { text: 'No — not perfect, needs work', qualify_logic: 'may', allow_free_text: true },
        ],
      },
      notesQuestion('One sentence: why ship or hold?'),
    ],
    tasks: [
      cheapActivity(
        'Open the ship form — PR + repo',
        `Read the feature, open ${prUrl} and https://github.com/${repo}, then: ship? if yes, is the code ready?`,
        page,
      ),
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
  let rows: any[]
  try {
    rows = await listSubmissions(jobId)
  } catch (e) {
    if (e instanceof TeracHttpError && RETRYABLE.has(e.status)) {
      return { verdict: 'waiting', reason: 'Terac is busy — retrying shortly.', expert: null }
    }
    throw e
  }
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
