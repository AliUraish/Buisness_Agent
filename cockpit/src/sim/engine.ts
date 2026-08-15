// The simulated company. A scripted-but-jittered event loop drives every
// surface of the cockpit: org-chart node states, edge particles, the
// activity feed, MRR, LLM spend, the feature board, the ship pipeline,
// the forecaster ensemble, and the loop counter.

import { AUDIENCE } from '../data/audience'
import { mulberry32 } from './rng'
import { fetchBars, fetchLatestPrices, submitPaperOrder, ORDERS_ENABLED } from './alpaca'
import { hireAllocationReview, hireClaimReview, hireShipReview, hireTradeReview, pollAllocationReview, pollClaimReview, pollShipReview, pollTradeReview } from './terac'
import { refreshLinqStatus, sendLinqMessage, sendLinqOnboard } from './linq'
import { fetchPaySummary, fetchStripeToday, TodayRevenue } from './pay'
import { extractJson, fetchLlmStatus, llmComplete, LlmProvider, LlmStatus } from './llm'
import { fetchDbStatus, journalEvent, loadJournal, loadState, putState } from './persist'
import { fetchPerfloSummary } from './perflo'
import { fetchResearchStatus, runResearch } from './research'
import { blankGithubScan, fetchGithubScan, shipGithubFeature, type GithubScan, type MarketingNeed } from './github'

export type { GithubScan, GithubCommit, GithubPr, MarketingNeed } from './github'

export type Dept = 'product' | 'marketing' | 'finance' | 'ceo' | 'alerts'

export const DEPT_COLOR: Record<Dept, string> = {
  product: '#7c6ff0',
  marketing: '#2ab3a6',
  finance: '#e8a33d',
  ceo: '#111111',
  alerts: '#e05c8a',
}

export interface FeedEvent {
  id: number
  time: string
  dept: Dept
  agent: string
  message: string
  chips?: string[]
  deltaUp?: string // e.g. "+$29" rendered in money green
}

export interface Particle {
  id: number
  edge: string // "from>to" — node ids from the org chart
  color: string
  start: number
  duration: number
}

export interface NodeState {
  status: 'idle' | 'thinking' | 'acting'
  chip?: string
}

export type FeatureStatus = 'shipped' | 'progress' | 'claimed'

export interface Feature {
  id: string
  name: string
  summary: string
  status: FeatureStatus
  chips: string[]
  file?: string
  shippedAt?: number
}

// ship-banner pipeline: 1 Detected → 2 Campaign → 3 Simulated → 4 Posted
export interface PipelineState {
  feature: string
  stage: number
  at: number
}

export interface Forecaster {
  model: string
  mono: string
  persona: string
  p50: number
  confidence: number
  rationale: string
}

export interface Tx {
  id: number
  at: number
  rail: string
  plan: string
  amount: number
  balance: number // running balance after this payment
}

export interface LlmCall {
  id: number
  at: number
  agent: string
  provider: string
  model: string
  tokens: number
  cost: number
}

export interface Post {
  id: number
  at: number
  campaign: number
  text: string
  predicted: number // engagement forecast from the persona sim
  actual: number | null // fills in a little while after posting
}

// ── Competition (mode 6) ───────────────────────────────────────
export interface Competitor {
  id: string
  name: string
  status: 'watching' | 'scanning' | 'reporting'
  threat: number // 0..1
  lastScanAt: number
  capIds: string[]
}

export interface Capability {
  id: string
  label: string
  ours: boolean
  flashAt?: number // recent change → matrix cell highlights briefly
}

export interface IntelMove {
  id: number
  at: number
  comp: string // competitor name
  text: string
  counter: string | null // CEO's counter-move, filled after analysis
  sources?: string[] // real citation domains when Perplexity researched it
}

// ── Ship pipeline: research → Repo Agent revises the python SDK → merge ──
export type ShipStage =
  | 'researching'
  | 'briefed'
  | 'building'
  | 'pr-open'
  | 'hiring-verify'
  | 'awaiting-verify'
  | 'rejected'
  | 'shipped'
  | 'blocked'

export type ResearcherStatus = 'queued' | 'working' | 'done'

export interface Researcher {
  agent: string
  mono: string
  status: ResearcherStatus
  note: string | null
}

export interface ShipGate {
  status: TeracStatus
  jobId: string | null
  expert: string | null
  quote: number | null
  live: boolean
  dashboardUrl: string | null
  verdict: 'approved' | 'rejected' | null
  reason: string | null
}

export interface AgentPr {
  number: number
  title: string
  branch: string
  file: string
  sha: string
  url?: string | null
  live?: boolean
  merged?: boolean
}

export interface ShipJob {
  id: number
  at: number
  capId: string
  feature: string
  summary: string
  rival: string
  brief: string
  file: string
  stage: ShipStage
  intelId: number
  researchers: Researcher[]
  gate: ShipGate
  pr: AgentPr | null
  featureId: string | null
}

// ── Investment (mode 7) ────────────────────────────────────────
export interface Vote {
  agent: string
  mono: string
  persona: string
  verdict: 'approve' | 'reject' | null
  reason: string | null
}

export interface Proposal {
  id: number
  at: number
  title: string
  detail: string
  amount: number
  kind: 'allocate' | 'spend'
  votes: Vote[]
  status: 'voting' | 'approved' | 'rejected' | 'executed'
}

export interface Treasury {
  cash: number
  burnMo: number
  yieldApy: number
  alloc: { label: string; amount: number }[]
}

// ── Market desk (mode 7) ───────────────────────────────────────
// Prices are simulated for now; the seam for the real Alpaca paper-trading
// API is this shape — swap the price loop + execution for Alpaca calls and
// nothing downstream changes.
export interface Asset {
  id: string
  symbol: string
  name: string
  price: number
  history: number[] // trailing ticks, oldest first
  changePct: number // vs. start of the trailing window
  vol: number // per-tick volatility used by the sim feed
}

export interface AssetPred {
  agent: string
  mono: string
  persona: string
  roi: Record<string, number> | null // predicted 30d ROI % per asset id; null = deliberating
}

// Terac gate on the deploy: a hired human expert states confidence in the
// trade before the money moves — mirrors the audience claim-review gate.
// 'expert' = a Terac expert answered; 'desk' = honest fallback confidence
// derived from agent agreement (Terac off / not answered yet).
export type TradeGateStatus = 'idle' | 'hiring' | 'waiting' | 'expert' | 'desk'

export interface TradeGate {
  status: TradeGateStatus
  live: boolean
  jobId: string | null
  dashboardUrl: string | null
  quote: number | null
  expert: string | null
  confidence: number | null // 0–100
  note: string | null
}

export interface MarketRound {
  id: number
  at: number
  preds: AssetPred[]
  consensus: { assetId: string; roi: number }[] | null // ranked, best first
  winner: string | null // asset id with highest consensus ROI
  amount: number
  status: 'predicting' | 'ranked' | 'executed'
  orderId: string | null
  entryPrice: number | null
  terac: TradeGate
}

export interface PositionRec {
  id: number
  at: number
  assetId: string
  qty: number
  cost: number // USD in at entry
  entry: number // entry price
}

// ── Support (mode 8) — customer service over Linq messaging ────
export type TicketStatus = 'open' | 'triaged' | 'drafting' | 'review' | 'sent' | 'resolved' | 'escalated'
export type TicketTopic = 'billing' | 'bug' | 'how-to' | 'feature' | 'churn-risk'

export interface TicketMsg {
  id: number
  from: 'customer' | 'business_agent'
  text: string
  at: number
  agent?: string // which support agent wrote it
  via?: 'sim' | 'linq' // how it was actually delivered
}

export interface Ticket {
  id: number
  at: number
  customer: string
  phone: string // masked — real numbers never enter the UI
  plan: string
  channel: 'iMessage' | 'SMS'
  topic: TicketTopic | null // null until triage
  priority: 'P1' | 'P2' | 'P3' | null
  status: TicketStatus
  msgs: TicketMsg[]
  csat: number | null // 1–5, lands after resolution
  firstResponseMs: number | null
}

// ── Bank + CFO (mode 4) ────────────────────────────────────────
// "Bob the Banker" holds the company's operating account. The CFO Agent
// owns the allocation — what share of the balance is committed to what —
// and rebalances it on its own clock with a stated reason.
export interface BankAlloc {
  label: string
  pct: number // whole percentage points; all allocs sum to exactly 100
}

export interface BankReview {
  status: 'none' | 'proposing' | 'waiting' | 'approved' | 'adjust' | 'skipped'
  jobId: string | null
  expert: string | null
  note: string | null
}

export interface Bank {
  name: string
  balance: number
  live: boolean // balance is a real Perflo read, not sim
  alloc: BankAlloc[]
  note: string | null // the CFO's latest rebalance reasoning
  lastRebalanceAt: number
  review: BankReview
  divided: boolean // has the CFO applied a full division this company-lifetime
}

// every real cost draws from Perflo first; when the limit is full,
// costs overflow to the Stripe balance — both pools visible
export interface Funding {
  perfloLimit: number // live available balance, or the sim limit
  perfloSpent: number
  stripeSpent: number
  source: 'perflo' | 'stripe'
}

// live payment-rail reads (Stripe test / Whop) loaded through the backend
export interface RailLive {
  live: boolean
  total: number | null // dollars, from recent successful payments
  count: number | null
  note: string | null
  recent: { id: string; amount: number; desc: string; created: number }[] // dollars, newest first
}

// ── Bug checks (support → product) ─────────────────────────────
// A bug reported over Linq gets routed to Product, where a randomly
// deployed engineer agent (Anthropic / Google / OpenAI pool) reproduces
// it and files a verdict. Simulated today — the seam for real model APIs
// is checkBug()/ENGINEERS: swap the scripted steps for real calls.
export interface Engineer {
  name: string
  provider: string
  model: string
  mono: string
}

export const ENGINEERS: Engineer[] = [
  { name: 'Claude Engineer', provider: 'Anthropic', model: 'claude-sonnet-5', mono: 'C' },
  { name: 'Gemini Engineer', provider: 'Google', model: 'gemini-3-pro', mono: 'G' },
  { name: 'GPT Engineer', provider: 'OpenAI', model: 'gpt-5', mono: 'O' },
]

export type BugCheckStatus = 'deploying' | 'reproducing' | 'checking' | 'done'

export interface BugCheck {
  id: number
  at: number
  ticketId: number
  customer: string
  text: string // the customer's bug report
  agent: Engineer
  status: BugCheckStatus
  verdict: 'confirmed' | 'not-reproduced' | null
  finding: string | null
  chips: string[] // file/commit receipts when confirmed
}

// ── Audience campaign sim (mode 2) ─────────────────────────────
// One cluster agent pulls X followers and groups them.
// Five writer agents each draft a post for the business account.
// Nine juror agents — cloned from top-engagement followers — vote.
export type DraftStatus = 'queued' | 'writing' | 'ready'
export type SimStage = 'idle' | 'queuing' | 'writing' | 'voting' | 'reviewing' | 'posted'
export type TeracStatus = 'idle' | 'hiring' | 'reviewing' | 'waiting' | 'approved' | 'revised' | 'error'

export interface DraftPost {
  id: number
  agent: string
  mono: string
  voice: string
  text: string | null
  status: DraftStatus
}

export interface JuryVote {
  followerId: number
  agent: string
  handle: string
  mono: string
  cluster: string
  pick: number | null
  reason: string | null
}

export interface TeracJob {
  status: TeracStatus
  jobId: string | null
  expert: string | null
  title: string | null
  quote: number | null
  verdict: string | null
  live: boolean
  dashboardUrl: string | null
}

export interface CampaignSim {
  campaign: number
  feature: string
  stage: SimStage
  pulled: number
  total: number
  lastPullAt: number
  drafts: DraftPost[]
  votes: JuryVote[]
  winnerId: number | null
  postedAt: number | null
  busy: boolean
  terac: TeracJob
}

export interface EngineState {
  mrr: number
  spendToday: number
  agentCount: number
  loops: number
  campaigns: number
  feed: FeedEvent[]
  particles: Particle[]
  nodes: Record<string, NodeState>
  spark: number[] // MRR samples, "last hour"
  features: Feature[]
  pipeline: PipelineState | null
  forecasters: Forecaster[]
  forecastAt: number
  forecastNote: { text: string; scheduled: number | null; at: number }
  railTotals: Record<string, number>
  repo: { commits: number[]; openPRs: number; lastScanAt: number }
  sessionCampaigns: { label: string; at: number }[]
  transactions: Tx[]
  llmCalls: LlmCall[]
  posts: Post[]
  competitors: Competitor[]
  capabilities: Capability[]
  intel: IntelMove[]
  shipJobs: ShipJob[]
  treasury: Treasury
  proposals: Proposal[]
  campaignSim: CampaignSim
  assets: Asset[]
  marketRounds: MarketRound[]
  positions: PositionRec[]
  marketFeed: 'connecting' | 'live' | 'sim'
  ordersLive: boolean
  tickets: Ticket[]
  linqLive: boolean
  paymentLink: string | null
  bugChecks: BugCheck[]
  github: GithubScan
  marketingQueue: MarketingNeed[]
  marketingPick: string | null
  bank: Bank
  funding: Funding
  railsLive: { stripe: RailLive; whop: RailLive }
  llm: LlmStatus | null
  dbLive: boolean
  stripeToday: TodayRevenue | null
}

interface BacklogItem {
  name: string
  summary: string
  file: string
}

const BACKLOG: BacklogItem[] = [
  { name: 'audit log', summary: 'Immutable trail of every account action', file: 'src/audit/log.ts' },
  { name: 'rate limiting', summary: 'Per-key sliding-window limits on the public API', file: 'src/api/ratelimit.ts' },
  { name: 'custom domains', summary: 'CNAME support with automatic TLS', file: 'src/domains/tls.ts' },
  { name: 'Slack alerts', summary: 'Usage and billing alerts piped to Slack', file: 'src/integrations/slack.ts' },
  { name: 'usage exports', summary: 'Nightly usage dumps to S3-compatible storage', file: 'src/export/usage.ts' },
  { name: 'RBAC', summary: 'Role-based access for team workspaces', file: 'src/org/rbac.ts' },
]

const PLANS = [
  { label: 'Starter', amount: 9 },
  { label: 'Pro', amount: 29 },
  { label: 'Pro', amount: 29 },
  { label: 'Scale', amount: 49 },
]
const RAILS = ['Stripe', 'Whop']

const FORECASTER_DEFS = [
  { model: 'GPT-5', mono: 'G', persona: 'Bull', bias: 0.08, rationales: ['Campaign cadence is compounding; infra segment underpriced.', 'Two consecutive launch bumps held — expansion revenue accelerating.'] },
  { model: 'Gemini', mono: 'Ge', persona: 'Bear', bias: -0.09, rationales: ['Launch bumps decay within 72h; baseline growth is flat.', 'Starter-tier mix rising — ARPU compression ahead.'] },
  { model: 'Claude', mono: 'C', persona: 'Churn-hawk', bias: -0.05, rationales: ['Three Starter accounts show usage decay consistent with churn.', 'Retention cohort at day-30 is 4pts below trend.'] },
  { model: 'Llama', mono: 'L', persona: 'Base-rate', bias: 0.0, rationales: ['Trailing 30d growth extrapolated, nothing more.', 'Median of last six weekly deltas, annualized.'] },
  { model: 'Mistral', mono: 'M', persona: 'Momentum', bias: 0.04, rationales: ['Post-launch CTR trend supports continued conversion lift.', 'Week-over-week signups up 11%; momentum intact.'] },
]

// the engine's boot MRR — the finance chart anchors its 30-day history to this
export const BOOT_MRR = 3841

// which department each agent bills its LLM spend to (ledger donut)
export const AGENT_DEPT: Record<string, Dept> = {
  'Repo Agent': 'product',
  'Manifest Builder': 'product',
  'Audience Scraper': 'marketing',
  'Persona Sim': 'marketing',
  'Content Studio': 'marketing',
  'Publisher': 'marketing',
  'Forecast Ensemble': 'finance',
  'Risk Sentinel': 'alerts',
  'Intel Tracker': 'alerts',
  'Diff Analyst': 'alerts',
  'Changelog Scout': 'alerts',
  'Gap Analyst': 'alerts',
  'Brief Writer': 'alerts',
  'Investment Committee': 'finance',
  'Market Desk': 'finance',
  'Support Triage': 'marketing',
  'Support Writer': 'marketing',
  'Support QA': 'marketing',
  'Bug Checker': 'product',
  'CFO Agent': 'finance',
  'Terac Liaison': 'alerts',
  Direct: 'marketing',
  Receipts: 'marketing',
  Operator: 'marketing',
  Narrative: 'marketing',
  Hook: 'marketing',
}

// five writer agents — each drafts one post for the business X account
export const WRITERS = [
  { agent: 'Direct', mono: 'D', voice: 'ship-it' },
  { agent: 'Receipts', mono: 'R', voice: 'evidence' },
  { agent: 'Operator', mono: 'O', voice: 'practical' },
  { agent: 'Narrative', mono: 'N', voice: 'story' },
  { agent: 'Hook', mono: 'H', voice: 'scroll-stop' },
] as const

const WRITER_COPY: Record<string, (f: string) => string> = {
  Direct: (f) => `${f} is live. Merged to main, in your account now — not on a roadmap.`,
  Receipts: (f) => `Shipped ${f}. PR merged, tests green, receipts attached. We don't announce vapor.`,
  Operator: (f) => `If you run this in prod: ${f} is on. No flag, no waitlist. Flip it in settings.`,
  Narrative: (f) => `We kept getting the same ask. So we shipped ${f} — the version that actually exists.`,
  Hook: (f) => `Most tools put ${f} on a slide. Ours is in production this morning.`,
}

// nine jurors cloned from top-engagement followers across the five clusters
export const JURY_QUOTAS: [string, number][] = [
  ['infra', 3],
  ['builders', 2],
  ['investors', 1],
  ['operators', 2],
  ['crypto', 1],
]

export interface JurySeat {
  followerId: number
  agent: string
  handle: string
  mono: string
  cluster: string
}

export function pickJury(): JurySeat[] {
  const seats: JurySeat[] = []
  for (const [cluster, n] of JURY_QUOTAS) {
    const top = AUDIENCE.followers
      .filter((f) => f.cluster === cluster)
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, n)
    for (const f of top) {
      seats.push({
        followerId: f.id,
        agent: f.name,
        handle: f.handle,
        mono: f.initials,
        cluster: f.cluster,
      })
    }
  }
  return seats
}

export const JURY = pickJury()

const AFFINITY: Record<string, string> = {
  infra: 'Receipts',
  builders: 'Direct',
  investors: 'Narrative',
  operators: 'Operator',
  crypto: 'Hook',
}

const JURY_REASONS: Record<string, string[]> = {
  infra: ['Cite the PR or I scroll past.', 'Evidence first. Then I amplify.'],
  builders: ['This is how I’d announce a ship.', 'Sounds like a founder who actually merged.'],
  investors: ['Signal: they ship. That’s the round story.', 'The post is the traction screenshot.'],
  operators: ['I can act on this today.', 'Clear next step. That’s rare.'],
  crypto: ['Punchy. I’d quote-tweet it.', 'Stops the thumb. That’s the job.'],
}

const TERAC_EXPERTS: Record<string, { name: string; title: string }> = {
  infra: { name: 'Priya Iyer', title: 'Staff infra engineer · 8y' },
  builders: { name: 'Jules Moreau', title: 'Founder · 2x shipped' },
  investors: { name: 'Marc Weiss', title: 'Seed investor · AI infra' },
  operators: { name: 'Dana Ortiz', title: 'Head of growth · B2B' },
  crypto: { name: 'Kai Nakamura', title: 'On-chain operator' },
}

const VOICE_CLUSTER: Record<string, string> = {
  Receipts: 'infra',
  Direct: 'builders',
  Narrative: 'investors',
  Operator: 'operators',
  Hook: 'crypto',
}

function blankTerac(): TeracJob {
  return { status: 'idle', jobId: null, expert: null, title: null, quote: null, verdict: null, live: false, dashboardUrl: null }
}

function blankDrafts(): DraftPost[] {
  return WRITERS.map((w, i) => ({
    id: i + 1,
    agent: w.agent,
    mono: w.mono,
    voice: w.voice,
    text: null,
    status: 'queued' as const,
  }))
}

function blankVotes(): JuryVote[] {
  return JURY.map((j) => ({
    followerId: j.followerId,
    agent: j.agent,
    handle: j.handle,
    mono: j.mono,
    cluster: j.cluster,
    pick: null,
    reason: null,
  }))
}

function seedCampaignSim(): CampaignSim {
  return {
    campaign: 3,
    feature: '',
    stage: 'idle',
    pulled: 1005,
    total: 1005,
    lastPullAt: Date.now() - 12_000,
    drafts: blankDrafts(),
    votes: blankVotes(),
    winnerId: null,
    postedAt: null,
    busy: false,
    terac: blankTerac(),
  }
}

export function plurality(votes: JuryVote[]): number | null {
  const counts = new Map<number, number>()
  for (const v of votes) {
    if (v.pick == null) continue
    counts.set(v.pick, (counts.get(v.pick) ?? 0) + 1)
  }
  let winner: number | null = null
  let best = 0
  for (const [id, n] of counts) {
    if (n > best) {
      winner = id
      best = n
    }
  }
  return winner
}

// investment committee: five personas, five monograms, five biases
export const COMMITTEE = [
  { agent: 'Prudence', mono: 'P', persona: 'risk-averse', tolerance: 0.35 },
  { agent: 'Momentum', mono: 'M', persona: 'growth-first', tolerance: 0.85 },
  { agent: 'Quant', mono: 'Q', persona: 'numbers-only', tolerance: 0.55 },
  { agent: 'Runway Guardian', mono: 'R', persona: 'default-alive', tolerance: 0.45 },
  { agent: 'Yield Scout', mono: 'Y', persona: 'idle-cash-hater', tolerance: 0.65 },
] as const

const VOTE_REASONS: Record<string, { approve: string[]; reject: string[] }> = {
  Prudence: {
    approve: ['Downside is capped and reversible.', 'Buffer stays above 3 months of burn.'],
    reject: ['Too much drawdown risk for the return.', 'Buffer dips below policy floor.'],
  },
  Momentum: {
    approve: ['Growth compounds — deploy while CAC is low.', 'Every idle dollar is a lost campaign.'],
    reject: ['Even I can’t model a return here.', 'This slows the launch cadence.'],
  },
  Quant: {
    approve: ['Expected value positive at P30.', 'Payback under 60 days at current conversion.'],
    reject: ['EV negative across the forecast band.', 'Sample too small to justify the spend.'],
  },
  'Runway Guardian': {
    approve: ['Runway unaffected — we stay default alive.', 'Net burn still negative after this.'],
    reject: ['This touches the reserve. No.', 'Runway math breaks if the bump misses.'],
  },
  'Yield Scout': {
    approve: ['Idle cash earning nothing is a bug.', 'T+0 liquidity — nothing is locked.'],
    reject: ['Yield pickup too small to bother.', 'Liquidity terms are worse than they look.'],
  },
}

interface ProposalDef {
  title: string
  detail: string
  amount: number
  risk: number
  kind: 'allocate' | 'spend'
  from?: string
  to?: string
}

const PROPOSAL_POOL: ProposalDef[] = [
  { title: 'Sweep idle cash to yield', detail: 'money-market · 4.1% APY · T+0 liquidity', amount: 4000, risk: 0.2, kind: 'allocate', from: 'Ops buffer', to: 'Yield' },
  { title: 'Fund counter-campaign budget', detail: 'ad boost behind the next launch post', amount: 250, risk: 0.45, kind: 'spend', from: 'Growth' },
  { title: 'Prepay Anthropic credits', detail: '12% discount on a 90-day commit', amount: 600, risk: 0.35, kind: 'spend', from: 'Ops buffer' },
  { title: 'Raise eval-harness budget', detail: 'two extra automated eval runs per week', amount: 120, risk: 0.3, kind: 'spend', from: 'Ops buffer' },
  { title: 'Move reserve into growth', detail: 'forecast P10 improved two cycles running', amount: 1500, risk: 0.72, kind: 'allocate', from: 'Reserve', to: 'Growth' },
  { title: 'Buy GPU spot reservation', detail: 'persona-sim cost down est. 18%', amount: 900, risk: 0.6, kind: 'spend', from: 'Growth' },
]

const COMPETITOR_MOVES: { text: string; threat: number; capId?: string }[] = [
  { text: 'shipped SSO', threat: 0.14, capId: 'sso' },
  { text: 'shipped audit log', threat: 0.1, capId: 'audit-log' },
  { text: 'opened public API beta', threat: 0.12, capId: 'api-keys' },
  { text: 'cut Pro pricing to $19/mo', threat: 0.16 },
  { text: 'raised a $4M seed round', threat: 0.12 },
  { text: 'launched a template gallery', threat: 0.06 },
  { text: 'started a full rewrite', threat: 0.04 },
  { text: 'poached two infra engineers', threat: 0.08 },
]

const COUNTERS = [
  'counter-campaign queued for next cycle',
  'pricing experiment scheduled on Starter tier',
  'matching feature bumped to top of backlog',
  'no action — off-thesis, monitoring only',
  'positioning update drafted for landing page',
]

const RESEARCHERS: { agent: string; mono: string }[] = [
  { agent: 'Changelog Scout', mono: 'CS' },
  { agent: 'Gap Analyst', mono: 'GA' },
  { agent: 'Brief Writer', mono: 'BW' },
]

export const SDK_SHIPS: { id: string; name: string; summary: string; file: string; rival: string; brief: string }[] = [
  {
    id: 'openai-tool-spans',
    name: 'OpenAI tool_use spans',
    summary: 'Copy tool_use names and counts onto the OpenAI request span',
    file: 'agentbasis/llms/openai/tool_spans.py',
    rival: 'OpenLLMetry',
    brief: 'OpenLLMetry records OpenAI tool_use names. agentbasis-python-sdk did not — Gap Analyst flagged it.',
  },
  {
    id: 'anthropic-stream-retry',
    name: 'Anthropic stream retry spans',
    summary: 'Retry/backoff spans when Messages.stream() drops mid-generator',
    file: 'agentbasis/llms/anthropic/stream_retry.py',
    rival: 'LangSmith',
    brief: 'LangSmith traces stream retries. Our Anthropic wrap ended the span on the first drop.',
  },
  {
    id: 'gemini-token-metrics',
    name: 'Gemini token metrics',
    summary: 'Prompt/completion token counts as span attributes on async Gemini calls',
    file: 'agentbasis/llms/gemini/token_metrics.py',
    rival: 'OpenLLMetry',
    brief: 'Gemini async calls were missing token metrics. Changelog Scout saw OpenLLMetry shipping them last week.',
  },
  {
    id: 'payload-redaction',
    name: 'payload redaction',
    summary: 'Redact prompts and completions before they hit the exporter',
    file: 'agentbasis/context_redaction.py',
    rival: 'LangSmith',
    brief: 'LangSmith redacts PII in traces by default. We were exporting raw prompts.',
  },
  {
    id: 'langchain-span-events',
    name: 'LangChain span events',
    summary: 'Emit span events for LangChain tool and chain starts',
    file: 'agentbasis/frameworks/langchain/span_events.py',
    rival: 'LangSmith',
    brief: 'LangChain users compare us to LangSmith. We had traces, not tool/chain events.',
  },
  {
    id: 'stream-cancel-events',
    name: 'stream cancel events',
    summary: 'Record an exception event when a stream is cancelled by the caller',
    file: 'agentbasis/llms/anthropic/cancel_events.py',
    rival: 'OpenLLMetry',
    brief: 'Cancelled Anthropic streams left orphan spans. Research: record the cancel as an event and close the span.',
  },
]

function blankShipGate(): ShipGate {
  return {
    status: 'idle',
    jobId: null,
    expert: null,
    quote: null,
    live: false,
    dashboardUrl: null,
    verdict: null,
    reason: null,
  }
}

// Never hire Terac on the SDK ship loop (backend/Agent.md). Research → GitHub merge.
export const SHIP_TERAC_ARMED = false
export const MAX_SDK_SHIPS = 6

const POST_TEMPLATES = [
  (f: string) => `${f} is live. Shipped, merged, and in your account right now — not on a roadmap. →`,
  (f: string) => `We just shipped ${f}. Built because you asked, grounded in code that actually merged today.`,
  (f: string) => `New: ${f}. No waitlist, no beta flag. Every plan, starting now.`,
  (f: string) => `${f} landed on main this morning. By tonight it's in prod for everyone.`,
]

// seeded "earlier today" ledger history so the tables aren't empty at boot
// LIVE-ONLY MODE: until the LLM API keys land, the cockpit shows no
// fabricated data. Real integrations (Stripe, GitHub, Alpaca, Terac, Linq,
// X audience) run; every mock seed and fabricating loop is gated off.
// Flip to false to restore the full simulation for rehearsals.
export const LIVE_ONLY = true

export function seedLedgers(): { transactions: Tx[]; llmCalls: LlmCall[]; posts: Post[]; spendToday: number } {
  const now = Date.now()
  const rails = ['Stripe', 'Whop', 'Stripe', 'Whop', 'Stripe', 'Whop']
  const plans = [
    { label: 'Pro', amount: 29 }, { label: 'Starter', amount: 9 }, { label: 'Scale', amount: 49 },
    { label: 'Pro', amount: 29 }, { label: 'Starter', amount: 9 }, { label: 'Pro', amount: 29 },
    { label: 'Scale', amount: 49 }, { label: 'Pro', amount: 29 }, { label: 'Starter', amount: 9 },
    { label: 'Pro', amount: 29 }, { label: 'Whop', amount: 29 }, { label: 'Pro', amount: 29 },
  ]
  const total = plans.reduce((s, p) => s + p.amount, 0)
  let balance = BOOT_MRR - total
  const transactions: Tx[] = plans.map((p, i) => {
    balance += p.amount
    return {
      id: -100 + i,
      at: now - (plans.length - i) * 19 * 60_000,
      rail: rails[i % rails.length],
      plan: p.label === 'Whop' ? 'Pro' : p.label,
      amount: p.amount,
      balance,
    }
  })

  const calls: [string, string, string, number][] = [
    ['Repo Agent', 'OpenAI', 'gpt-5-mini', 0.0041],
    ['Manifest Builder', 'Anthropic', 'claude-haiku-4-5', 0.0062],
    ['Audience Scraper', 'OpenAI', 'text-embedding-4', 0.0308],
    ['Persona Sim', 'Anthropic', 'claude-sonnet-5', 0.0481],
    ['Content Studio', 'Anthropic', 'claude-opus-5', 0.0520],
    ['Persona Sim', 'Anthropic', 'claude-haiku-4-5', 0.0189],
    ['Forecast Ensemble', 'multi', 'ensemble ×5', 0.0411],
    ['Repo Agent', 'OpenAI', 'gpt-5-mini', 0.0043],
    ['Manifest Builder', 'Anthropic', 'claude-haiku-4-5', 0.0058],
    ['Persona Sim', 'Anthropic', 'claude-sonnet-5', 0.0472],
    ['Content Studio', 'Anthropic', 'claude-opus-5', 0.0535],
    ['Publisher', 'OpenAI', 'gpt-5-mini', 0.0021],
    ['Forecast Ensemble', 'multi', 'ensemble ×5', 0.0409],
  ]
  const llmCalls: LlmCall[] = calls.map(([agent, provider, model, cost], i) => ({
    id: -200 + i,
    at: now - (calls.length - i) * 11 * 60_000,
    agent,
    provider,
    model,
    tokens: Math.round(cost / 0.0000031),
    cost,
  }))
  const spendToday = llmCalls.reduce((s, c) => s + c.cost, 0)

  const posts: Post[] = [
    { id: -301, at: now - 170 * 60_000, campaign: 1, text: POST_TEMPLATES[2]('usage-based billing'), predicted: 74, actual: 91 },
    { id: -302, at: now - 95 * 60_000, campaign: 2, text: POST_TEMPLATES[0]('API keys'), predicted: 88, actual: 83 },
    { id: -303, at: now - 40 * 60_000, campaign: 3, text: POST_TEMPLATES[3]('webhooks v2'), predicted: 96, actual: 121 },
  ]

  return { transactions, llmCalls, posts, spendToday }
}

const SEED = seedLedgers()

// how each desk persona turns momentum into a 30d ROI call
// mw = momentum weight · majorBias applies to BTC/ETH · noise = spread
export const DESK_STYLE: Record<string, { mw: number; majorBias: number; altBias: number; noise: number }> = {
  Prudence: { mw: 0.35, majorBias: 1.4, altBias: -1.2, noise: 1.0 },
  Momentum: { mw: 1.6, majorBias: 0.2, altBias: 0.8, noise: 2.2 },
  Quant: { mw: 0.9, majorBias: 0.0, altBias: 0.0, noise: 1.2 },
  'Runway Guardian': { mw: 0.45, majorBias: 0.6, altBias: -0.8, noise: 1.0 },
  'Yield Scout': { mw: 0.7, majorBias: 1.0, altBias: 0.3, noise: 1.5 },
}

const MAJORS = new Set(['btc', 'eth'])

// deterministic trailing price history so charts look identical every load
export function seedMarket(): { assets: Asset[]; positions: PositionRec[]; round: MarketRound } {
  const rand = mulberry32(77021)
  const defs: [string, string, string, number, number][] = [
    ['btc', 'BTC', 'Bitcoin', 118400, 0.0009],
    ['eth', 'ETH', 'Ethereum', 4620, 0.0012],
    ['sol', 'SOL', 'Solana', 172.4, 0.0016],
    ['doge', 'DOGE', 'Dogecoin', 0.218, 0.0022],
    ['avax', 'AVAX', 'Avalanche', 29.4, 0.0018],
  ]
  const assets: Asset[] = defs.map(([id, symbol, name, price, vol]) => {
    // walk backwards from the live price, then flip to oldest-first
    const back: number[] = [price]
    let p = price
    for (let i = 0; i < 109; i++) {
      p = p / (1 + (rand() - 0.48) * 2 * vol)
      back.push(p)
    }
    const history = back.reverse()
    return { id, symbol, name, price, history, changePct: (price / history[0] - 1) * 100, vol }
  })

  const now = Date.now()

  const roiFor = (agent: string, mom: Record<string, number>) =>
    Object.fromEntries(
      assets.map((a) => {
        const st = DESK_STYLE[agent]
        const bias = MAJORS.has(a.id) ? st.majorBias : st.altBias
        return [a.id, mom[a.id] * st.mw + bias + (rand() - 0.5) * 2 * st.noise]
      }),
    )
  const seededMom: Record<string, number> = { btc: 1.1, eth: 0.6, sol: 2.4, doge: -0.9, avax: 0.4 }
  const preds: AssetPred[] = COMMITTEE.map((c) => ({ agent: c.agent, mono: c.mono, persona: c.persona, roi: roiFor(c.agent, seededMom) }))
  const consensus = assets
    .map((a) => ({ assetId: a.id, roi: preds.reduce((s, p) => s + (p.roi?.[a.id] ?? 0), 0) / preds.length }))
    .sort((x, y) => y.roi - x.roi)

  // the seeded position derives from the seeded round's actual winner —
  // bought a couple hours ago, slightly below the live price
  const winner = assets.find((a) => a.id === consensus[0].assetId)!
  const entry = winner.price * 0.958
  const positions: PositionRec[] = [
    { id: -601, at: now - 124 * 60_000, assetId: winner.id, qty: 500 / entry, cost: 500, entry },
    // and one honest loser: DOGE bought above the live price
    { id: -602, at: now - 58 * 60_000, assetId: 'doge', qty: 250 / 0.231, cost: 250, entry: 0.231 },
  ]
  const agreeing = preds.filter((p) => {
    const roi = p.roi!
    return Object.entries(roi).sort((a, b) => b[1] - a[1])[0][0] === winner.id
  }).length
  const round: MarketRound = {
    id: -603,
    at: now - 124 * 60_000,
    preds,
    consensus,
    winner: winner.id,
    amount: 500,
    status: 'executed',
    orderId: 'alp_9c41f2e',
    entryPrice: entry,
    terac: {
      status: 'desk',
      live: false,
      jobId: null,
      dashboardUrl: null,
      quote: null,
      expert: null,
      confidence: Math.min(30 + 14 * agreeing, 95),
      note: `${agreeing} of 5 agents ranked ${winner.symbol} first — seeded history, no expert hired`,
    },
  }

  return { assets, positions, round }
}

const MARKET = seedMarket()

// ── Support content pools ──────────────────────────────────────
const SUPPORT_CUSTOMERS: { name: string; plan: string; channel: 'iMessage' | 'SMS' }[] = [
  { name: 'Mira Okafor', plan: 'Scale', channel: 'iMessage' },
  { name: 'Dev Chandra', plan: 'Pro', channel: 'iMessage' },
  { name: 'Sana Novak', plan: 'Starter', channel: 'SMS' },
  { name: 'Kai Lindqvist', plan: 'Pro', channel: 'iMessage' },
  { name: 'Lena Alvarez', plan: 'Scale', channel: 'SMS' },
  { name: 'Ravi Iyer', plan: 'Pro', channel: 'iMessage' },
  { name: 'Noor Haddad', plan: 'Starter', channel: 'SMS' },
  { name: 'Theo Moreau', plan: 'Pro', channel: 'iMessage' },
]

const SUPPORT_ISSUES: { topic: TicketTopic; priority: 'P1' | 'P2' | 'P3'; text: string; reply: string; followup: string }[] = [
  {
    topic: 'bug',
    priority: 'P1',
    text: 'Anthropic Messages.stream() spans never close — traces pile up in our collector after a few minutes.',
    reply: 'Reproduced on agentbasis-python-sdk main — _WrappedStreamManager dropped the end span on generator exit. I patched the wrap and your missed spans should stop landing. Restart the instrumented process to pick it up.',
    followup: 'Collector is clean now. Thanks.',
  },
  {
    topic: 'bug',
    priority: 'P2',
    text: 'Gemini instrumentation misses tool_use names on async calls — we only see the parent span.',
    reply: 'Confirmed — async Gemini tool_use attributes were never copied onto the child span. That’s the gap PR #1/#2 were closing. Upgrade to the latest sdk; tool names should show on async calls.',
    followup: 'Seeing tool names on the async path now.',
  },
  {
    topic: 'billing',
    priority: 'P2',
    text: 'Did the Python SDK start double-counting token usage? Our Gemini bill jumped after we upgraded.',
    reply: 'The tracer was attributing both the stream chunk and the final message. I flagged your project so usage is counted once; the extra Gemini tokens from last week are noted on the invoice as a credit.',
    followup: 'Credit showed up. Appreciate it.',
  },
  {
    topic: 'how-to',
    priority: 'P3',
    text: 'How do I wrap AsyncMessages.stream so OpenTelemetry gets tool count attributes?',
    reply: 'Use the instrumented AsyncMessages from agentbasis — don’t wrap stream() yourself. Tool count and tool_use names are added on the request span automatically after PR #4. Call `instrument()` once at process start.',
    followup: 'That was the missing piece, thanks!',
  },
  {
    topic: 'feature',
    priority: 'P3',
    text: 'Any plans to instrument tool_use names on Anthropic the way you did for Gemini?',
    reply: 'Shipped — Anthropic tool improvement merged as PR #4. Upgrade agentbasis-python-sdk and the request spans carry tool count + tool use names.',
    followup: 'We’ll bump the pin this afternoon.',
  },
  {
    topic: 'churn-risk',
    priority: 'P1',
    text: 'Honestly considering dropping the SDK and wiring OpenTelemetry ourselves — Gemini traces have been incomplete for weeks.',
    reply: '', // churn risk is never auto-answered — routed to the human queue
    followup: '',
  },
]

// what the engineer agent finds per bug (keyed by the customer's report)
const BUG_FINDINGS: Record<string, { finding: string; chips: string[] }> = {
  'Anthropic Messages.stream() spans never close — traces pile up in our collector after a few minutes.': {
    finding: '_WrappedStreamManager does not emit the end span when the generator exits. Reproduced on main.',
    chips: ['_WrappedStreamManager', 'PR #4'],
  },
  'Gemini instrumentation misses tool_use names on async calls — we only see the parent span.': {
    finding: 'Async Gemini path never copies tool_use names onto the child span. Reproduced on main.',
    chips: ['gemini instrumentation', 'PR #1'],
  },
}

function maskedPhone(rand: () => number): string {
  return `+1 ··· ·· ${String(Math.floor(rand() * 90) + 10)}${String(Math.floor(rand() * 9))}`
}

export function seedSupport(): Ticket[] {
  const rand = mulberry32(88104)
  const now = Date.now()
  const mk = (
    id: number,
    minsAgo: number,
    ci: number,
    ii: number,
    status: TicketStatus,
    csat: number | null,
    frMs: number | null,
  ): Ticket => {
    const c = SUPPORT_CUSTOMERS[ci]
    const issue = SUPPORT_ISSUES[ii]
    const at = now - minsAgo * 60_000
    const msgs: TicketMsg[] = [{ id: id * 10, from: 'customer', text: issue.text, at }]
    if (status === 'resolved') {
      msgs.push({ id: id * 10 + 1, from: 'business_agent', text: issue.reply, at: at + (frMs ?? 60_000), agent: 'Support Writer', via: 'sim' })
      msgs.push({ id: id * 10 + 2, from: 'customer', text: issue.followup, at: at + (frMs ?? 60_000) + 4 * 60_000 })
    }
    return {
      id,
      at,
      customer: c.name,
      phone: maskedPhone(rand),
      plan: c.plan,
      channel: c.channel,
      topic: status === 'open' ? null : issue.topic,
      priority: status === 'open' ? null : issue.priority,
      status,
      msgs,
      csat,
      firstResponseMs: frMs,
    }
  }
  return [
    mk(-701, 158, 0, 0, 'resolved', 5, 41_000),
    mk(-702, 96, 2, 2, 'resolved', 3, 87_000), // honest middling rating
    mk(-703, 44, 4, 5, 'escalated', null, null), // churn risk — human queue, no auto-reply
    mk(-704, 2, 1, 3, 'open', null, null),
  ]
}

export function seedBugChecks(): BugCheck[] {
  const now = Date.now()
  const webhookBug = SUPPORT_ISSUES[0]
  const csvBug = SUPPORT_ISSUES[1]
  return [
    {
      id: -801,
      at: now - 156 * 60_000,
      ticketId: -701,
      customer: 'Mira Okafor',
      text: webhookBug.text,
      agent: ENGINEERS[0], // Claude Engineer
      status: 'done',
      verdict: 'confirmed',
      finding: BUG_FINDINGS[webhookBug.text].finding,
      chips: BUG_FINDINGS[webhookBug.text].chips,
    },
    {
      id: -802,
      at: now - 71 * 60_000,
      ticketId: -790, // an older report, ticket since rotated out
      customer: 'Theo Moreau',
      text: csvBug.text,
      agent: ENGINEERS[2], // GPT Engineer — honest miss
      status: 'done',
      verdict: 'not-reproduced',
      finding: 'Could not reproduce on main with a 2-minute Gemini async tool_use run — requested the failing span id from the customer.',
      chips: [],
    },
  ]
}

type Listener = () => void

function fmtTime(d: Date) {
  return d.toTimeString().slice(0, 8)
}

function hash7() {
  return Math.floor(Math.random() * 0xfffffff).toString(16).padStart(7, 'a')
}

class Engine {
  state: EngineState = {
    mrr: LIVE_ONLY ? 0 : BOOT_MRR,
    spendToday: LIVE_ONLY ? 0 : SEED.spendToday,
    agentCount: 43, // + Changelog Scout / Gap Analyst / Brief Writer (intel desk)
    loops: LIVE_ONLY ? 0 : 2,
    campaigns: LIVE_ONLY ? 0 : 3,
    feed: [],
    particles: [],
    nodes: {},
    spark: [],
    features: LIVE_ONLY ? [] : [
      { id: 'f1', name: 'webhooks v2', summary: 'Signed delivery with retries and replay protection', status: 'shipped', chips: ['PR #63', 'src/webhooks.ts', 'e41b2c9'], shippedAt: 0 },
      { id: 'f2', name: 'API keys', summary: 'Scoped keys with per-key usage metering', status: 'shipped', chips: ['PR #58', 'src/api/keys.ts', 'b93d1f0'], shippedAt: 0 },
      { id: 'f3', name: 'usage-based billing', summary: 'Metered billing synced to Stripe usage records', status: 'shipped', chips: ['PR #52', 'src/billing/meter.ts', 'c07aa41'], shippedAt: 0 },
      { id: 'f4', name: 'dark-mode', summary: 'Full theme system with system-preference sync', status: 'progress', chips: ['PR #47 · draft', 'branch: theme'], file: 'src/theme.ts' },
      { id: 'f5', name: 'team seats', summary: 'Seat-based workspaces with owner/member roles', status: 'progress', chips: ['PR #71 · draft', 'branch: seats'], file: 'src/org/seats.ts' },
      { id: 'f6', name: 'CSV export', summary: 'One-click export of usage and billing data', status: 'progress', chips: ['PR #76 · draft', 'branch: export'], file: 'src/export/csv.ts' },
      { id: 'f7', name: 'realtime collab', summary: 'Mentioned in README — no code found', status: 'claimed', chips: ['README.md §Features'] },
      { id: 'f8', name: 'mobile app', summary: 'On the landing page — no repo, no PR', status: 'claimed', chips: ['landing page'] },
    ],
    pipeline: null,
    forecasters: [],
    forecastAt: 0,
    forecastNote: { text: '', scheduled: null, at: 0 },
    railTotals: LIVE_ONLY ? { Stripe: 0, Whop: 0 } : { Stripe: 2455, Whop: 1386 },
    repo: LIVE_ONLY
      ? { commits: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], openPRs: 0, lastScanAt: Date.now() }
      : { commits: [3, 5, 2, 6, 4, 8, 5, 7, 4, 6, 9, 5, 7, 6], openPRs: 4, lastScanAt: Date.now() },
    sessionCampaigns: [],
    transactions: LIVE_ONLY ? [] : SEED.transactions,
    llmCalls: LIVE_ONLY ? [] : SEED.llmCalls,
    posts: LIVE_ONLY ? [] : SEED.posts,
    competitors: [
      { id: 'langsmith', name: 'LangSmith', status: 'watching', threat: 0.62, lastScanAt: 0, capIds: ['tracing', 'evals', 'prompt-management', 'datasets', 'dashboards'] },
      { id: 'langfuse', name: 'Langfuse', status: 'watching', threat: 0.48, lastScanAt: 0, capIds: ['tracing', 'evals', 'prompt-management', 'cost-tracking', 'dashboards', 'otel'] },
      { id: 'helicone', name: 'Helicone', status: 'watching', threat: 0.31, lastScanAt: 0, capIds: ['tracing', 'cost-tracking', 'dashboards'] },
    ],
    capabilities: [
      { id: 'tracing', label: 'agent tracing', ours: false },
      { id: 'otel', label: 'OpenTelemetry', ours: false },
      { id: 'evals', label: 'evals', ours: false },
      { id: 'prompt-management', label: 'prompt management', ours: false },
      { id: 'cost-tracking', label: 'cost tracking', ours: false },
      { id: 'dashboards', label: 'dashboards', ours: false },
      { id: 'datasets', label: 'datasets', ours: false },
      { id: 'session-replay', label: 'session replay', ours: false },
    ],
    intel: LIVE_ONLY
      ? []
      : [
          { id: -401, at: Date.now() - 125 * 60_000, comp: 'Autonomo', text: 'shipped audit log', counter: 'matching feature bumped to top of backlog' },
          { id: -402, at: Date.now() - 51 * 60_000, comp: 'Loopwork', text: 'cut Pro pricing to $19/mo', counter: 'pricing experiment scheduled on Starter tier' },
        ],
    shipJobs: [],
    treasury: {
      cash: 48210,
      burnMo: 1240,
      yieldApy: 4.1,
      alloc: [
        { label: 'Yield', amount: 36000 },
        { label: 'Ops buffer', amount: 6000 },
        { label: 'Growth', amount: LIVE_ONLY ? 3500 : 2750 },
        { label: 'Reserve', amount: 2710 },
        { label: 'Crypto', amount: LIVE_ONLY ? 0 : 750 }, // = open positions at cost
      ],
    },
    proposals: LIVE_ONLY ? [] : [
      {
        id: -501,
        at: Date.now() - 96 * 60_000,
        title: 'Sweep idle cash to yield',
        detail: 'money-market · 4.1% APY · T+0 liquidity',
        amount: 4000,
        kind: 'allocate',
        status: 'executed',
        votes: COMMITTEE.map((c) => ({ agent: c.agent, mono: c.mono, persona: c.persona, verdict: 'approve' as const, reason: VOTE_REASONS[c.agent].approve[0] })),
      },
      {
        id: -502,
        at: Date.now() - 41 * 60_000,
        title: 'Move reserve into growth',
        detail: 'forecast P10 improved two cycles running',
        amount: 1500,
        kind: 'allocate',
        status: 'rejected',
        votes: COMMITTEE.map((c, i) => ({
          agent: c.agent,
          mono: c.mono,
          persona: c.persona,
          verdict: (i === 1 ? 'approve' : 'reject') as 'approve' | 'reject',
          reason: i === 1 ? VOTE_REASONS[c.agent].approve[0] : VOTE_REASONS[c.agent].reject[0],
        })),
      },
    ],
    campaignSim: seedCampaignSim(),
    assets: MARKET.assets,
    marketRounds: LIVE_ONLY ? [] : [MARKET.round],
    positions: LIVE_ONLY ? [] : MARKET.positions,
    marketFeed: 'connecting',
    ordersLive: ORDERS_ENABLED,
    tickets: LIVE_ONLY ? [] : seedSupport(),
    linqLive: false,
    paymentLink: null,
    bugChecks: LIVE_ONLY ? [] : seedBugChecks(),
    bank: {
      name: 'Perflo',
      live: false,
      balance: 0, // sim off — only a real Perflo read fills this
      alloc: [
        { label: 'Payroll & Ops', pct: 24 },
        { label: 'Taxes reserve', pct: 21 },
        { label: 'Marketing', pct: 17 },
        { label: 'Investment', pct: 14 },
        { label: 'Infra & compute', pct: 10 },
        { label: 'R&D', pct: 8 },
        { label: 'Cash buffer', pct: 6 },
      ],
      note: 'Baseline allocation set at account opening.',
      lastRebalanceAt: Date.now() - 47 * 60_000,
      review: { status: 'none', jobId: null, expert: null, note: null },
      divided: false,
    },
    funding: { perfloLimit: 0, perfloSpent: 0, stripeSpent: 0, source: 'stripe' }, // stripe until Perflo is live
    railsLive: {
      stripe: { live: false, total: null, count: null, note: null, recent: [] },
      whop: { live: false, total: null, count: null, note: null, recent: [] },
    },
    stripeToday: null,
    llm: null,
    dbLive: false,
    github: blankGithubScan(),
    marketingQueue: [],
    marketingPick: null,
  }

  private listeners = new Set<Listener>()
  private nextId = 1
  private nextPr = 78
  private nextFeatureId = 100
  private backlogIdx = 0
  private timers: ReturnType<typeof setTimeout>[] = []
  private started = false
  private teracPoll: ReturnType<typeof setInterval> | null = null
  private tradePoll: ReturnType<typeof setInterval> | null = null
  // ONE Terac hire per session across ALL gates — the human budget is tiny
  // ($4 on the account) and every study costs ~$5+. Attempts count too.
  private teracHiresUsed = 0
  private readonly TERAC_HIRE_BUDGET = 1
  private linqSendDone = false
  private lastExpertReading: { confidence: number; expert: string | null; note: string; at: number } | null = null
  private pendingPublish: { feature: string; camp: number; winner: DraftPost; tally: number } | null = null
  private shipBusy = false
  private teracShipBlocked = false

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  private sleep(ms: number) {
    // ±18% jitter so the loop never feels metronomic
    const jittered = ms * (0.82 + Math.random() * 0.36)
    // one-shot handles are not retained — only long-lived intervals go in timers
    return new Promise<void>((res) => {
      setTimeout(res, jittered)
    })
  }

  private log(dept: Dept, agent: string, message: string, chips?: string[], deltaUp?: string) {
    this.state.feed.push({
      id: this.nextId++,
      time: fmtTime(new Date()),
      dept,
      agent,
      message,
      chips,
      deltaUp,
    })
    if (this.state.feed.length > 80) this.state.feed.splice(0, this.state.feed.length - 80)
    // append-only journal in Neon — the feed survives reloads
    if (this.state.dbLive) journalEvent({ dept, agent, message, chips, delta: deltaUp })
    this.emit()
  }

  private setNode(id: string, status: NodeState['status'], chip?: string) {
    this.state.nodes[id] = { status, chip }
    this.emit()
  }

  private fire(edge: string, color: string, duration = 1400) {
    // prune here too — Overview's rAF only prunes while that mode is mounted
    const now = performance.now()
    this.state.particles = this.state.particles.filter((p) => now - p.start < p.duration)
    this.state.particles.push({ id: this.nextId++, edge, color, start: now, duration })
    this.emit()
  }

  pruneParticles(now: number) {
    const before = this.state.particles.length
    this.state.particles = this.state.particles.filter((p) => now - p.start < p.duration)
    if (this.state.particles.length !== before) this.emit()
  }

  // every model call becomes a ledger row — the LLM ledger IS the spend counter.
  // In live-only mode no real model is called, so no row is fabricated.
  private llm(agent: string, provider: string, model: string, cost: number) {
    if (LIVE_ONLY) return
    const jittered = cost * (0.85 + Math.random() * 0.3)
    this.state.llmCalls.push({
      id: this.nextId++,
      at: Date.now(),
      agent,
      provider,
      model,
      tokens: Math.round(jittered / 0.0000031),
      cost: jittered,
    })
    if (this.state.llmCalls.length > 60) this.state.llmCalls.shift()
    this.state.spendToday += jittered
    this.emit()
  }

  private setPipeline(feature: string, stage: number) {
    this.state.pipeline = { feature, stage, at: this.state.pipeline?.feature === feature ? this.state.pipeline.at : Date.now() }
    this.emit()
  }

  private payment() {
    // real Stripe connected → sim payments stop; the prize metric must
    // never be inflated by fake revenue
    if (this.state.stripeToday?.live) return
    const plan = PLANS[Math.floor(Math.random() * PLANS.length)]
    const rail = RAILS[Math.floor(Math.random() * RAILS.length)]
    this.state.mrr += plan.amount
    this.state.railTotals[rail] += plan.amount
    this.state.transactions.push({
      id: this.nextId++,
      at: Date.now(),
      rail,
      plan: plan.label,
      amount: plan.amount,
      balance: this.state.mrr,
    })
    if (this.state.transactions.length > 40) this.state.transactions.shift()
    this.fire('ceo>ledger', DEPT_COLOR.finance, 1100)
    this.log('finance', 'Ledger', `Payment captured — ${plan.label} plan · ${rail}`, [rail.toLowerCase() + '_ch_' + Math.floor(Math.random() * 9000 + 1000)], `+$${plan.amount}`)
  }

  private modelMrr(): number {
    return LIVE_ONLY ? Math.max(this.state.mrr, BOOT_MRR) : this.state.mrr
  }

  private runForecast() {
    const base = this.modelMrr() * (1.05 + Math.random() * 0.08)
    const wideDay = Math.random() < 0.3 // occasionally the ensemble splits
    this.state.forecasters = FORECASTER_DEFS.map((d) => {
      const noise = (Math.random() - 0.5) * (wideDay ? 0.1 : 0.035)
      return {
        model: d.model,
        mono: d.mono,
        persona: d.persona,
        p50: Math.round(base * (1 + d.bias * (wideDay ? 1.6 : 1) + noise)),
        confidence: 0.55 + Math.random() * 0.37,
        rationale: d.rationales[Math.floor(Math.random() * d.rationales.length)],
      }
    })
    this.state.forecastAt = Date.now()
    this.emit()
  }

  forecastP50(): number {
    const fs = this.state.forecasters
    if (fs.length === 0) return Math.round(this.modelMrr() * 1.09)
    const wsum = fs.reduce((s, f) => s + f.confidence, 0)
    return Math.round(fs.reduce((s, f) => s + f.p50 * f.confidence, 0) / wsum)
  }

  // restore the company's memory from Neon: journal + domain snapshots
  private async hydrate() {
    const st = await fetchDbStatus()
    this.state.dbLive = Boolean(st?.live)
    if (!this.state.dbLive) return
    const [events, kv] = await Promise.all([loadJournal(80), loadState()])
    const restored: FeedEvent[] = events.map((e: any) => ({
      id: this.nextId++,
      time: new Date(e.at).toTimeString().slice(0, 8),
      dept: (e.dept ?? 'ceo') as Dept,
      agent: String(e.agent ?? ''),
      message: String(e.message ?? ''),
      chips: Array.isArray(e.chips) && e.chips.length ? e.chips : undefined,
      deltaUp: e.delta ?? undefined,
    }))
    this.state.feed = restored.slice(-80)
    const k = kv as Record<string, any>
    const st8 = this.state
    if (k.llmLedger) {
      st8.llmCalls = Array.isArray(k.llmLedger.calls) ? k.llmLedger.calls : []
      st8.spendToday = Number(k.llmLedger.spendToday) || 0
    }
    if (Array.isArray(k.positions)) st8.positions = k.positions
    if (Array.isArray(k.marketRounds)) st8.marketRounds = k.marketRounds.filter((r: any) => r?.status === 'executed')
    if (k.bank?.alloc)
      st8.bank = {
        ...k.bank,
        name: 'Perflo',
        live: false,
        balance: 0, // sim off — wait for the live read
        divided: k.bank.divided ?? false,
        review: k.bank.review ?? { status: 'none', jobId: null, expert: null, note: null },
      }
    if (k.funding) st8.funding = { ...st8.funding, ...k.funding }
    if (Array.isArray(k.tickets))
      st8.tickets = k.tickets.map((t: any) =>
        ['triaged', 'drafting', 'review', 'sent'].includes(t?.status) ? { ...t, status: 'open' } : t,
      )
    if (Array.isArray(k.posts)) st8.posts = k.posts
    if (Array.isArray(k.bugChecks))
      st8.bugChecks = k.bugChecks.map((b: any) =>
        b?.status !== 'done' ? { ...b, status: 'done', verdict: b?.verdict ?? 'not-reproduced', finding: b?.finding ?? 'session ended mid-check' } : b,
      )
    if (Array.isArray(k.capabilities) && k.capabilities.length) st8.capabilities = k.capabilities
    if (k.counters) {
      st8.loops = Number(k.counters.loops) || st8.loops
      st8.campaigns = Number(k.counters.campaigns) || st8.campaigns
      st8.sessionCampaigns = Array.isArray(k.counters.sessionCampaigns) ? k.counters.sessionCampaigns : []
    }
    // restored records carry old ids — keep new ids clear of them
    const maxId = Math.max(
      0,
      ...st8.llmCalls.map((c) => c.id),
      ...st8.positions.map((x) => x.id),
      ...st8.marketRounds.map((x) => x.id),
      ...st8.tickets.map((x) => x.id),
      ...st8.posts.map((x) => x.id),
      ...st8.bugChecks.map((x) => x.id),
    )
    if (maxId >= this.nextId) this.nextId = maxId + 1
    this.log('ceo', 'Orchestrator', `Memory restored from Neon — ${restored.length} journal events, state rehydrated`, ['postgres'])
    const snap = setInterval(() => this.persistSlices(), 30_000)
    this.timers.push(snap as unknown as ReturnType<typeof setTimeout>)
    this.emit()
  }

  private persistSlices() {
    if (!this.state.dbLive) return
    const s = this.state
    putState('llmLedger', { calls: s.llmCalls, spendToday: s.spendToday })
    putState('positions', s.positions)
    putState('marketRounds', s.marketRounds)
    putState('bank', s.bank)
    putState('tickets', s.tickets)
    putState('posts', s.posts)
    putState('bugChecks', s.bugChecks)
    putState('capabilities', s.capabilities)
    putState('counters', { loops: s.loops, campaigns: s.campaigns, sessionCampaigns: s.sessionCampaigns })
  }

  start() {
    if (this.started) return
    this.started = true
    void this.boot()
  }

  // hydrate from Neon first so restored history is in place before any
  // loop logs new events, then run the normal startup
  private async boot() {
    try {
      await this.hydrate()
    } catch (e) {
      console.error('[engine] hydrate failed, starting fresh:', e)
    }

    if (!LIVE_ONLY) {
      // seed the sparkline with a plausible last hour, never overshooting live MRR
      let v = this.state.mrr - 320
      for (let i = 0; i < 60; i++) {
        if (Math.random() < 0.18) v = Math.min(v + [9, 29, 29, 49][Math.floor(Math.random() * 4)], this.state.mrr)
        this.state.spark.push(v)
      }
      this.state.spark[this.state.spark.length - 1] = this.state.mrr
    }

    // the finance page keeps its original look: forecast ensemble + report
    // run in every mode (the modelled view), anchored at the model MRR
    this.runForecast()
    {
      const p50 = this.forecastP50()
      this.state.forecastNote = { text: this.reportText(p50), scheduled: null, at: Date.now() }
    }

    // sparkline sampler
    const sample = setInterval(() => {
      this.state.spark.push(this.state.mrr)
      if (this.state.spark.length > 60) this.state.spark.shift()
      this.emit()
    }, 3000)
    this.timers.push(sample as unknown as ReturnType<typeof setTimeout>)

    // ambient payments between campaigns (mock — off in live-only mode)
    if (!LIVE_ONLY) {
      const ambient = setInterval(() => {
        if (Math.random() < 0.35) this.payment()
      }, 11000)
      this.timers.push(ambient as unknown as ReturnType<typeof setTimeout>)
    }

    // price feed: real Alpaca crypto data when reachable, sim walk otherwise.
    // The sim also covers the 'connecting' window so charts move immediately.
    this.initMarket()
    const ids = this.state.assets.map((a) => a.id)
    let pollBusy = false
    let pollFails = 0
    const ticker = setInterval(() => {
      if (this.state.marketFeed === 'live') {
        if (pollBusy) return
        pollBusy = true
        fetchLatestPrices(ids)
          .then((latest) => {
            pollFails = 0
            for (const a of this.state.assets) {
              const p = latest[a.id]
              if (p) a.price = p
              a.history.push(a.price)
              if (a.history.length > 120) a.history.shift()
              a.changePct = (a.price / a.history[0] - 1) * 100
            }
            this.emit()
          })
          .catch(() => {
            pollFails++
            if (pollFails >= 3) {
              this.state.marketFeed = 'sim'
              this.log('finance', 'Market Desk', 'Live feed dropped — falling back to simulated prices')
              this.emit()
            }
          })
          .finally(() => {
            pollBusy = false
          })
      } else {
        for (const a of this.state.assets) {
          a.price = Math.max(a.price * (1 + (Math.random() - 0.48) * 2 * a.vol), 1e-6)
          a.history.push(a.price)
          if (a.history.length > 120) a.history.shift()
          a.changePct = (a.price / a.history[0] - 1) * 100
        }
        this.emit()
      }
    }, 2500)
    this.timers.push(ticker as unknown as ReturnType<typeof setTimeout>)

    // fabricating loops are off in live-only mode; real loops always run
    if (!LIVE_ONLY) {
      this.runLoop()
      this.runCompetitionLoop()
      this.runInvestmentLoop()
    }

    // agent brains: if any LLM provider is configured, the desk and CFO run
    // for real — actual model calls, actual ledger rows
    void fetchLlmStatus().then((st) => {
      this.state.llm = st
      if (st && (st.anthropic || st.openai || st.gemini)) {
        const on = [st.anthropic && 'Anthropic', st.openai && 'OpenAI', st.gemini && 'Gemini'].filter(Boolean).join(' · ')
        this.log('ceo', 'Orchestrator', `Agent brains online — ${on} · session cap ${st.callsMax} calls`, ['real LLM'])
        if (LIVE_ONLY) {
          this.runInvestmentLoop()
          this.runBankLoop()
          void this.planAllocation()
        }
      } else if (LIVE_ONLY) {
        this.log('ceo', 'Orchestrator', 'No LLM keys configured — agent reasoning paused', ['llm off'])
      }
      this.emit()
    })
    this.runGithubLoop()
    this.runProductShipLoop()

    // support: check Linq once (our own backend, free). Onboard send is
    // Support-mode "Text subscribe link" — recipient must text the org first.
    void refreshLinqStatus().then((st) => {
      this.state.linqLive = st.live
      this.state.paymentLink = st.paymentLink
      if (st.live) this.log('marketing', 'Support Triage', 'Linq messaging connected — replies deliver over iMessage/SMS', ['api.linqapp.com'])
      if (st.live && st.paymentLink) {
        this.log('marketing', 'Support Writer', 'Subscribe link armed — Support mode texts it to the onboard phone', ['stripe'])
      } else if (st.live && !st.paymentLink) {
        this.log('marketing', 'Support Writer', 'Linq live, no subscribe link — set STRIPE_PAYMENT_LINK to text onboarders', ['needs link'])
      }
      this.emit()
    })
    if (!LIVE_ONLY) this.runSupportLoop() // fake inbound texts — off until Linq webhooks

    // finance: load real rails once; re-poll sparsely only if something is live
    void this.loadRails(true)
    void this.pollPerflo(true)
    void this.runResearchLoop()
    if (!LIVE_ONLY) this.runBankLoop() // (with brains online the LIVE_ONLY path starts it above)

    // prize metric: revenue earned today from the real Stripe account.
    // Our own backend gates on the key, so polling stays local when off.
    void this.pollStripeToday()
    const todayPoll = setInterval(() => void this.pollStripeToday(), 60_000)
    this.timers.push(todayPoll as unknown as ReturnType<typeof setTimeout>)
  }

  // ── Competition research: real Perplexity sweeps on real rivals ──
  private async runResearchLoop() {
    const st = await fetchResearchStatus()
    if (!st?.live) {
      this.log('alerts', 'Changelog Scout', 'Perplexity off — competitive research paused', ['no key'])
      return
    }
    this.log('alerts', 'Changelog Scout', 'Perplexity research online — sweeping rivals in AI agent observability', ['sonar', 'live'])
    await this.sleep(20000)
    for (const rival of this.state.competitors) {
      try {
        await this.researchRival(rival)
      } catch (e) {
        console.error('[engine] rival research failed:', e)
      }
      await this.sleep(240_000) // one rival every ~4 minutes — research costs real money
    }
  }

  private async researchRival(rival: Competitor) {
    rival.status = 'scanning'
    this.emit()
    const r = await runResearch(
      `What has ${rival.name} shipped or announced recently for AI agent / LLM observability (tracing, evals, prompt management, cost tracking, OpenTelemetry)? Newest features and pricing changes only. 3 bullet points max.`,
      `You research competitors of AgentBasis, an AI agent observability platform. Be concrete, recent, and cite sources.`,
    )
    rival.lastScanAt = Date.now()
    if (!r || !r.live || r.error || !r.text.trim()) {
      rival.status = 'watching'
      if (r?.error) this.log('alerts', 'Changelog Scout', `${rival.name} research failed — ${r.error.slice(0, 80)}`)
      this.emit()
      return
    }
    rival.status = 'reporting'
    const summary = r.text.replace(/\s+/g, ' ').slice(0, 220)
    const sources = [
      ...new Set(
        r.citations.map((u) => {
          try {
            return new URL(u).hostname.replace(/^www\./, '')
          } catch {
            return u.slice(0, 30)
          }
        }),
      ),
    ].slice(0, 4)
    const entry: IntelMove = { id: this.nextId++, at: Date.now(), comp: rival.name, text: summary, counter: null, sources }
    this.state.intel.push(entry)
    if (this.state.intel.length > 12) this.state.intel.shift()
    this.log('alerts', 'Changelog Scout', `${rival.name}: ${summary.slice(0, 110)}`, sources.slice(0, 2))
    this.emit()

    // Gap Analyst (real LLM) turns the research into a counter-move
    const counter = await this.agentBrain(
      'Gap Analyst',
      'anthropic',
      'You are the Gap Analyst at AgentBasis, an AI agent observability platform (python SDK). Given rival research, reply with ONE short sentence: the most important counter-move for AgentBasis. No preamble.',
      `Rival: ${rival.name}. Research findings: ${r.text.slice(0, 900)}`,
      80,
    )
    if (counter) {
      entry.counter = counter.replace(/\s+/g, ' ').slice(0, 140)
      this.log('ceo', 'Orchestrator', `Counter to ${rival.name}: ${entry.counter}`, ['gap analysis'])
    }
    rival.status = 'watching'
    this.emit()
  }

  // ── Bug check: support routes a bug to Product, a random engineer
  // agent (Anthropic / Google / OpenAI) reproduces it and files a verdict.
  // SEAM: replace the scripted steps below with real model API calls —
  // everything downstream only reads the BugCheck record.
  private async runBugCheck(ticket: Ticket) {
    const S = this.sleep.bind(this)
    const agent = ENGINEERS[Math.floor(Math.random() * ENGINEERS.length)]
    const check: BugCheck = {
      id: this.nextId++,
      at: Date.now(),
      ticketId: ticket.id,
      customer: ticket.customer,
      text: ticket.msgs[0].text,
      agent,
      status: 'deploying',
      verdict: null,
      finding: null,
      chips: [],
    }
    this.state.bugChecks.unshift(check)
    if (this.state.bugChecks.length > 8) this.state.bugChecks.pop()
    this.log('product', 'Support Triage', `Bug from ${ticket.customer} routed to Product — deploying ${agent.name}`, [agent.model])
    this.fire('ceo>repo', DEPT_COLOR.product, 1200)
    this.setNode('repo', 'acting', `${agent.name} on the bug…`)
    this.emit()

    await S(2200)
    check.status = 'reproducing'
    this.emit()
    await S(3200)
    this.llm('Bug Checker', agent.provider, agent.model, 0.012)
    check.status = 'checking'
    this.emit()
    await S(2800)
    this.llm('Bug Checker', agent.provider, agent.model, 0.018)

    const known = BUG_FINDINGS[check.text]
    if (known && Math.random() < 0.8) {
      check.verdict = 'confirmed'
      check.finding = known.finding
      check.chips = known.chips
      this.log('product', 'Bug Checker', `${agent.name} confirmed ${ticket.customer}'s bug — ${known.finding.slice(0, 80)}`, known.chips)
    } else {
      check.verdict = 'not-reproduced'
      check.finding = 'Could not reproduce on main — requested exact repro steps from the customer.'
      this.log('product', 'Bug Checker', `${agent.name} could not reproduce ${ticket.customer}'s report — asked for repro steps`, ['honest miss'])
    }
    check.status = 'done'
    this.setNode('repo', 'idle')
    this.emit()
  }

  // ── Revenue today (Stripe) — the prize metric ──────────────────
  private async pollStripeToday() {
    const today = await fetchStripeToday()
    if (!today) return
    const prev = this.state.stripeToday
    this.state.stripeToday = today
    if (LIVE_ONLY && today.live) this.state.mrr = Math.round(today.grossCents / 100)
    if (today.live && !prev?.live) {
      this.log(
        'finance',
        'Ledger',
        `Stripe connected (${today.mode}) — revenue today $${(today.grossCents / 100).toFixed(2)} across ${today.count} payments`,
        ['read-only', today.mode ?? ''],
      )
    }
    // a real payment landed since the last poll — celebrate it honestly
    if (today.live && prev?.live && today.grossCents > prev.grossCents) {
      const delta = (today.grossCents - prev.grossCents) / 100
      this.fire('ceo>ledger', DEPT_COLOR.finance, 1100)
      this.log('finance', 'Ledger', `Stripe payment received — revenue today $${(today.grossCents / 100).toFixed(2)}`, [today.mode ?? ''], `+$${delta.toFixed(2)}`)
    }
    this.emit()
  }

  // ── Finance: real rails + the CFO's bank allocation ────────────
  private async loadRails(first: boolean) {
    const sum = await fetchPaySummary()
    if (sum) {
      const toRecent = (r: { id: string; amountCents: number; desc: string; created: number }) => ({
        id: r.id,
        amount: r.amountCents / 100,
        desc: r.desc,
        created: r.created,
      })
      this.state.railsLive = {
        stripe: {
          live: sum.stripe.live,
          total: sum.stripe.totalCents != null ? sum.stripe.totalCents / 100 : null,
          count: sum.stripe.count,
          note: sum.stripe.note,
          recent: sum.stripe.recent.map(toRecent),
        },
        whop: {
          live: sum.whop.live,
          total: sum.whop.totalCents != null ? sum.whop.totalCents / 100 : null,
          count: sum.whop.count,
          note: sum.whop.note,
          recent: sum.whop.recent.map(toRecent),
        },
      }
      if (first) {
        const bits = [
          sum.stripe.live ? `Stripe test connected — ${sum.stripe.count} recent charges` : 'Stripe off',
          sum.whop.live ? `Whop connected — ${sum.whop.count} payments` : 'Whop off',
        ]
        this.log('finance', 'Ledger', bits.join(' · '), ['read-only'])
      }
      this.emit()
    }
    // one sparse re-poll cycle, only while something is actually live
    if (sum && (sum.stripe.live || sum.whop.live)) {
      this.timers.push(setTimeout(() => void this.loadRails(false), 60_000))
    }
  }

  // Divide the whole account sensibly: the CFO Agent (real LLM) proposes
  // the split with reasoning, then a Terac human reviews it — using the
  // session's single hire. A Terac balance failure refunds the hire slot.
  private async planAllocation() {
    const bank = this.state.bank
    if (bank.divided) return // a real division already applied (this or a prior session)
    if (!bank.live) return // sim off — only divide real Perflo money
    bank.review.status = 'proposing'
    this.emit()
    const rev = this.state.stripeToday
    const text = await this.agentBrain(
      'CFO Agent',
      'anthropic',
      `You are the CFO Agent of Business_Agent, an autonomous software company. Divide the ENTIRE operating account at ${bank.name} (balance $${bank.balance.toLocaleString()}) across sensible business categories. Reply with ONLY compact JSON, no markdown: {"alloc": [{"label": "<category>", "pct": <integer>}...], "rationale": "<ONE short sentence>"} — 5 to 7 categories, short labels, integer percents summing to exactly 100, covering at least payroll/ops, taxes, marketing, investment, and a cash buffer.`,
      `Company facts: revenue today $${((rev?.grossCents ?? 0) / 100).toFixed(2)} (Stripe ${rev?.mode ?? 'off'}), LLM spend today $${this.state.spendToday.toFixed(2)}, team is entirely AI agents (no salaries yet, but keep a payroll/ops line for contractors and Terac hires). Divide the account as JSON only.`,
      350,
      'smart',
    )
    const parsed = text ? extractJson(text) : null
    const rows: { label: string; pct: number }[] = Array.isArray(parsed?.alloc)
      ? parsed.alloc
          .map((a: any) => ({ label: String(a?.label ?? '').slice(0, 28), pct: Math.round(Number(a?.pct)) }))
          .filter((a: any) => a.label && Number.isFinite(a.pct) && a.pct > 0)
      : []
    const sum = rows.reduce((a, r) => a + r.pct, 0)
    if (rows.length >= 4 && rows.length <= 9 && sum > 0) {
      rows[0].pct += 100 - sum // force exactly 100 after rounding
      if (rows[0].pct > 0) {
        bank.alloc = rows
        bank.note = String(parsed?.rationale ?? 'Division proposed by the CFO Agent.').slice(0, 220)
        bank.lastRebalanceAt = Date.now()
        bank.divided = true
        this.log('finance', 'CFO Agent', `Divided ${bank.name} ($${bank.balance.toLocaleString()}): ${rows.map((r) => `${r.label} ${r.pct}%`).join(' · ')}`, ['real LLM'])
      }
    } else {
      this.log('finance', 'CFO Agent', 'Division proposal failed to parse — keeping the baseline split', ['fallback'])
    }
    this.emit()
    await this.reviewAllocation()
  }

  private async reviewAllocation() {
    const bank = this.state.bank
    if (this.teracHiresUsed >= this.TERAC_HIRE_BUDGET) {
      bank.review = { status: 'skipped', jobId: null, expert: null, note: 'session hire budget already used' }
      this.emit()
      return
    }
    this.teracHiresUsed++
    bank.review.status = 'waiting'
    this.emit()
    try {
      const hired = await hireAllocationReview({
        bankName: bank.name,
        balance: bank.balance,
        alloc: bank.alloc,
        rationale: bank.note ?? 'CFO division',
      })
      if (hired.verdict === 'error' || !hired.jobId) {
        // insufficient Terac balance costs nothing — refund the hire slot
        if (/412|401|insufficient balance|invalid or expired/i.test(hired.reason)) this.teracHiresUsed--
        bank.review = { status: 'skipped', jobId: null, expert: null, note: hired.reason.slice(0, 120) }
        this.log('alerts', 'Terac Liaison', `Treasury review skipped — ${hired.reason.slice(0, 100)}`, ['no hire'])
        this.emit()
        return
      }
      bank.review = { status: 'waiting', jobId: hired.jobId, expert: null, note: 'human reviewing the division' }
      this.log('alerts', 'Terac Liaison', `Treasury division sent for human review — $${bank.balance.toLocaleString()} across ${bank.alloc.length} categories`, [hired.jobId, 'live'])
      this.emit()
      // sparing background poll: every 30s, give up after 10 minutes
      let polls = 0
      const t = setInterval(() => {
        polls++
        if (polls > 20 || !bank.review.jobId || ['approved', 'adjust'].includes(bank.review.status)) {
          clearInterval(t)
          return
        }
        void pollAllocationReview(bank.review.jobId)
          .then((v) => {
            if (v.verdict === 'waiting') return
            bank.review = { status: v.verdict === 'approved' ? 'approved' : 'adjust', jobId: bank.review.jobId, expert: v.expert, note: v.reason.slice(0, 140) }
            this.log('alerts', 'Terac Liaison', `${v.expert ?? 'Human'} ${v.verdict === 'approved' ? 'approved' : 'flagged'} the treasury division — ${v.reason.slice(0, 90)}`, [v.verdict])
            clearInterval(t)
            this.emit()
          })
          .catch(() => undefined)
      }, 30_000)
      this.timers.push(t as unknown as ReturnType<typeof setTimeout>)
    } catch (e) {
      bank.review = { status: 'skipped', jobId: null, expert: null, note: (e instanceof Error ? e.message : 'hire failed').slice(0, 120) }
      this.emit()
    }
  }

  private async pollPerflo(first: boolean) {
    const sum = await fetchPerfloSummary()
    if (sum?.live && sum.available != null) {
      const bank = this.state.bank
      const wasLive = bank.live
      bank.live = true
      bank.balance = Math.round(sum.balance ?? sum.available)
      this.state.funding.perfloLimit = Math.max(sum.available, 0)
      if (!wasLive) {
        this.state.funding.source = 'perflo'
        void this.planAllocation() // divide REAL money once it exists
      }
      if (!wasLive && first) {
        this.log('finance', 'CFO Agent', `Perflo connected — live balance $${bank.balance.toLocaleString()}, agent spend limit $${this.state.funding.perfloLimit.toFixed(2)}`, ['api-gateway.perflo.ai', 'live'])
      }
      this.emit()
      this.timers.push(setTimeout(() => void this.pollPerflo(false), 120_000))
    } else if (first && sum?.note) {
      this.log('finance', 'CFO Agent', `Perflo off — ${sum.note.slice(0, 90)} Using sim balance, costs metered locally.`, ['sim'])
      this.emit()
    }
  }

  // charge a real cost to the funding pools: Perflo first, Stripe overflow
  private chargeCost(amount: number) {
    const f = this.state.funding
    if (!this.state.bank.live) {
      f.stripeSpent += amount
      return
    }
    if (f.source === 'perflo' && f.perfloSpent + amount > f.perfloLimit) {
      f.source = 'stripe'
      this.log('finance', 'CFO Agent', `Perflo spend limit ($${f.perfloLimit.toFixed(2)}) reached — costs now drawing from Stripe`, ['overflow'])
    }
    if (f.source === 'perflo') f.perfloSpent += amount
    else f.stripeSpent += amount
  }

  private async runBankLoop() {
    await this.sleep(20000)
    for (;;) {
      try {
        await this.cfoRebalance()
      } catch (e) {
        console.error('[engine] CFO rebalance failed, continuing:', e)
      }
      await this.sleep(LIVE_ONLY ? 300_000 : 50000)
    }
  }

  private async cfoRebalance() {
    const S = this.sleep.bind(this)
    const bank = this.state.bank
    const MOVES: { from: string; to: string; reason: string }[] = [
      { from: 'Cash buffer', to: 'Taxes reserve', reason: 'Q3 estimated taxes accrue next month' },
      { from: 'R&D', to: 'Marketing', reason: 'last two launch campaigns beat predicted engagement' },
      { from: 'Marketing', to: 'Investment', reason: 'desk consensus ROI above threshold two rounds running' },
      { from: 'Investment', to: 'Cash buffer', reason: 'forecaster disagreement above normal range — de-risking' },
      { from: 'Infra & compute', to: 'R&D', reason: 'GPU reservation renewal came in 12% under budget' },
      { from: 'Payroll & Ops', to: 'Infra & compute', reason: 'persona-sim usage trending up with campaign cadence' },
      { from: 'Taxes reserve', to: 'Payroll & Ops', reason: 'quarterly filing done — releasing the over-reserve' },
    ]
    let move: { from: string; to: string; reason: string }
    let pts: number
    if (this.llmAvailable()) {
      const labels = bank.alloc.map((a) => `${a.label}: ${a.pct}%`).join(', ')
      const rev = this.state.stripeToday
      const text = await this.agentBrain(
        'CFO Agent',
        'anthropic',
        `You are the CFO Agent of Business_Agent, an autonomous company. You manage the operating account at ${bank.name} (balance $${bank.balance.toLocaleString()}). Reply with ONLY JSON: {"from": "<category>", "to": "<category>", "pts": 1|2, "reason": "<one sentence>"} — move 1-2 percentage points between two existing categories, or {"from": null} to hold.`,
        `Current allocation: ${labels}.\nRevenue today (Stripe ${rev?.mode ?? 'off'}): $${((rev?.grossCents ?? 0) / 100).toFixed(2)} across ${rev?.count ?? 0} payments.\nLLM spend today: $${this.state.spendToday.toFixed(2)}.\nDecide one small rebalance (or hold) as JSON only.`,
        140,
      )
      const parsed = text ? extractJson(text) : null
      if (!parsed || parsed.from == null) return // CFO chose to hold (or no valid reply)
      const okFrom = bank.alloc.find((a) => a.label === parsed.from)
      const okTo = bank.alloc.find((a) => a.label === parsed.to)
      const okPts = Number(parsed.pts)
      if (!okFrom || !okTo || okFrom === okTo || !Number.isFinite(okPts)) return
      move = { from: okFrom.label, to: okTo.label, reason: String(parsed.reason ?? 'rebalance').slice(0, 140) }
      pts = Math.min(Math.max(Math.round(okPts), 1), 2)
    } else {
      move = MOVES[Math.floor(Math.random() * MOVES.length)]
      pts = 1 + Math.floor(Math.random() * 2) // 1–2 percentage points
    }
    const from = bank.alloc.find((a) => a.label === move.from)!
    const to = bank.alloc.find((a) => a.label === move.to)!
    if (from.pct - pts < 2) return // never drain a category below 2%

    this.setNode('ledger', 'acting', 'CFO rebalancing…')
    this.emit()
    await S(2200)
    if (!this.llmAvailable()) this.llm('CFO Agent', 'Anthropic', 'claude-sonnet-5', 0.009)
    from.pct -= pts
    to.pct += pts
    bank.note = `${move.reason} — ${move.from} → ${move.to} ${pts}pt`
    bank.lastRebalanceAt = Date.now()
    this.log(
      'finance',
      'CFO Agent',
      `Rebalanced ${bank.name}: ${move.from} ${from.pct + pts}%→${from.pct}%, ${move.to} ${to.pct - pts}%→${to.pct}% — ${move.reason}`,
      [`$${bank.balance.toLocaleString()}`],
    )
    this.setNode('ledger', 'idle')
    this.emit()
  }

  // Linq texts the Stripe subscribe link to the onboard phone (one send / session).
  async sendOnboard(): Promise<void> {
    if (this.linqSendDone) {
      this.log('marketing', 'Support Writer', 'Onboard already sent this session — Linq is one shot', ['linq'])
      this.emit()
      return
    }
    const st = await refreshLinqStatus()
    this.state.linqLive = st.live
    this.state.paymentLink = st.paymentLink
    if (!st.live) {
      this.log('marketing', 'Support Writer', 'Linq off — cannot text the subscribe link', ['needs key'])
      this.emit()
      return
    }
    if (!st.paymentLink) {
      this.log('marketing', 'Support Writer', 'No subscribe link — set STRIPE_PAYMENT_LINK=https://buy.stripe.com/…', ['needs link'])
      this.emit()
      return
    }
    this.linqSendDone = true
    this.setNode('support', 'acting', 'texting subscribe link…')
    this.emit()
    const sent = await sendLinqOnboard()
    const text =
      sent.text?.trim() ||
      (this.state.paymentLink
        ? `You're in. Subscribe here (Stripe, cancel anytime):\n${this.state.paymentLink}\nAgents start operating the company the moment you pay.`
        : 'Subscribe link missing.')
    const via: 'sim' | 'linq' = !sent.error && sent.messageId ? 'linq' : 'sim'
    const ticket: Ticket = {
      id: this.nextId++,
      at: Date.now(),
      customer: 'Onboard',
      phone: 'test phone',
      plan: 'subscribe',
      channel: 'SMS',
      topic: 'billing',
      priority: 'P2',
      status: via === 'linq' ? 'sent' : 'open',
      msgs: [{ id: this.nextId++, from: 'business_agent', text, at: Date.now(), agent: 'Support Writer', via }],
      csat: null,
      firstResponseMs: 0,
    }
    this.state.tickets.push(ticket)
    if (this.state.tickets.length > 20) this.state.tickets.shift()
    if (via === 'linq') {
      this.log('marketing', 'Support Writer', 'Onboard text sent — Stripe subscribe link via Linq', [sent.messageId ?? 'linq', sent.service ?? 'sms'])
    } else {
      this.log(
        'marketing',
        'Support Writer',
        `Onboard Linq send failed — ${(sent.error ?? 'unknown').slice(0, 90)}`,
        ['linq'],
      )
    }
    this.setNode('support', 'idle')
    this.emit()
  }

  // ── Support: inbound texts triaged, drafted, QA'd, and answered ──
  private async runSupportLoop() {
    await this.sleep(10000)
    for (;;) {
      try {
        await this.supportTick()
      } catch (e) {
        console.error('[engine] support tick failed, continuing:', e)
      }
      await this.sleep(15000)
    }
  }

  private async supportTick() {
    const S = this.sleep.bind(this)
    const active = this.state.tickets.filter((t) => !['resolved', 'escalated'].includes(t.status))

    // new inbound when the queue is quiet
    if (active.length === 0 || (active.length < 3 && Math.random() < 0.45)) {
      const c = SUPPORT_CUSTOMERS[Math.floor(Math.random() * SUPPORT_CUSTOMERS.length)]
      const issue = SUPPORT_ISSUES[Math.floor(Math.random() * SUPPORT_ISSUES.length)]
      const ticket: Ticket = {
        id: this.nextId++,
        at: Date.now(),
        customer: c.name,
        phone: `+1 ··· ·· ${Math.floor(Math.random() * 900) + 100}`,
        plan: c.plan,
        channel: c.channel,
        topic: null,
        priority: null,
        status: 'open',
        msgs: [{ id: this.nextId++, from: 'customer', text: issue.text, at: Date.now() }],
        csat: null,
        firstResponseMs: null,
      }
      this.state.tickets.push(ticket)
      if (this.state.tickets.length > 20) this.state.tickets.shift()
      this.log('marketing', 'Support Triage', `Inbound ${c.channel} from ${c.name} (${c.plan})`, ['new ticket'])
      this.emit()
      return
    }

    // advance the oldest active ticket through the pipeline
    const t = active[0]
    const issue = SUPPORT_ISSUES.find((i) => i.text === t.msgs[0].text) ?? SUPPORT_ISSUES[2]

    if (t.status === 'open') {
      t.status = 'triaged'
      await S(2000)
      t.topic = issue.topic
      t.priority = issue.priority
      this.llm('Support Triage', 'Anthropic', 'claude-haiku-4-5', 0.004)
      if (issue.topic === 'churn-risk') {
        t.status = 'escalated'
        this.log('alerts', 'Risk Sentinel', `Churn risk from ${t.customer} — routed to human queue, no auto-reply`, ['P1', 'escalated'])
        this.emit()
        return
      }
      this.log('marketing', 'Support Triage', `Classified ${t.customer}: ${issue.topic} · ${issue.priority}`)
      this.emit()
      // bugs also go to Product: a random engineer agent gets deployed to check
      if (issue.topic === 'bug') void this.runBugCheck(t)
      return
    }

    if (t.status === 'triaged') {
      t.status = 'drafting'
      this.emit()
      await S(3000)
      this.llm('Support Writer', 'Anthropic', 'claude-sonnet-5', 0.021)
      t.status = 'review'
      this.emit()
      await S(1600)
      this.llm('Support QA', 'Anthropic', 'claude-haiku-4-5', 0.003)

      // deliver: one real Linq send per session, honest sim otherwise
      let via: 'sim' | 'linq' = 'sim'
      if (this.state.linqLive && !this.linqSendDone) {
        this.linqSendDone = true // even a failed attempt uses the session's one shot
        const sent = await sendLinqMessage(issue.reply)
        if (!sent.error && sent.messageId) {
          via = 'linq'
          this.log('marketing', 'Support Writer', `Replied to ${t.customer} via Linq ${sent.service ?? 'message'}`, [sent.messageId, 'linq'])
        } else {
          this.log('marketing', 'Support Writer', `Linq send failed — recording sim delivery. ${(sent.error ?? '').slice(0, 90)}`)
        }
      }
      t.msgs.push({ id: this.nextId++, from: 'business_agent', text: issue.reply, at: Date.now(), agent: 'Support Writer', via })
      t.firstResponseMs = Date.now() - t.at
      t.status = 'sent'
      if (via === 'sim') this.log('marketing', 'Support Writer', `Replied to ${t.customer} — ${issue.topic} · QA approved`, ['sim send'])
      this.emit()
      return
    }

    if (t.status === 'sent') {
      await S(1500)
      t.msgs.push({ id: this.nextId++, from: 'customer', text: issue.followup, at: Date.now() })
      t.status = 'resolved'
      t.csat = [5, 5, 5, 4, 4, 3][Math.floor(Math.random() * 6)]
      this.log('marketing', 'Support QA', `Resolved ${t.customer} — CSAT ${t.csat}/5`, [`${Math.round((t.firstResponseMs ?? 0) / 1000)}s first response`])
      this.emit()
    }
  }

  // Audience: Start queues five writer agents. Uses the next committed
  // feature from the Product → marketing queue when GitHub has one.
  startCampaign = (): boolean => {
    const sim = this.state.campaignSim
    if (sim.busy) return false
    sim.busy = true
    this.emit()
    const queued = this.state.marketingQueue.filter((q) => q.status === 'queued')
    const pick = queued.find((q) => q.id === this.state.marketingPick) ?? queued[0]
    const shipped = this.state.features
      .filter((f) => f.status === 'shipped')
      .sort((a, b) => (b.shippedAt ?? 0) - (a.shippedAt ?? 0))
    const feature = pick?.feature ?? shipped[0]?.name ?? 'webhooks v2'
    if (pick) {
      pick.status = 'posting'
      this.state.marketingPick = pick.id
    }
    this.state.campaigns++
    const camp = this.state.campaigns
    this.state.sessionCampaigns.push({ label: `campaign #${camp} — ${feature}`, at: Date.now() })
    if (this.state.sessionCampaigns.length > 10) this.state.sessionCampaigns.shift()
    void this.runAudienceCampaign(feature, camp).catch((e) => {
      console.error('[engine] campaign failed:', e)
      sim.busy = false
      sim.stage = 'idle'
      if (pick) pick.status = 'queued'
      this.emit()
    })
    return true
  }

  selectMarketingNeed = (id: string) => {
    const item = this.state.marketingQueue.find((q) => q.id === id)
    if (!item || item.status !== 'queued') return
    this.state.marketingPick = id
    this.emit()
  }

  setGithubRepo = (_repo: string) => {
    // Product is pinned to AgentBasis/agentbasis-python-sdk.
  }

  applyGithubScan = (scan: GithubScan) => {
    const prevIds = new Set(this.state.marketingQueue.map((q) => q.id))
    this.state.github = scan
    if (!scan.live) {
      this.emit()
      return 0
    }
    const shippedByName = new Map(this.state.features.filter((f) => f.status === 'shipped').map((f) => [f.name, f]))
    this.state.features = scan.features.map((f) => {
      const prev = shippedByName.get(f.name)
      return {
        id: f.id,
        name: f.name,
        summary: f.summary,
        status: (prev ? 'shipped' : 'progress') as Feature['status'],
        chips: prev?.chips ?? f.chips,
        file: prev?.file,
        shippedAt: prev?.shippedAt,
      }
    })
    this.state.repo = {
      commits: scan.commitsPerDay.length ? scan.commitsPerDay : this.state.repo.commits,
      openPRs: scan.openPRs,
      lastScanAt: scan.lastScanAt,
    }
    for (const job of this.state.shipJobs) {
      if (job.stage === 'rejected' || job.stage === 'blocked') continue
      if (job.pr) this.ensureShipFeature(job)
    }
    const liveIds = new Set(scan.features.map((f) => f.id))
    this.state.marketingQueue = this.state.marketingQueue.filter(
      (q) => q.status !== 'queued' || liveIds.has(q.id) || q.id.startsWith('ship-'),
    )
    let added = 0
    for (const f of scan.features) {
      if (this.state.marketingQueue.some((q) => q.id === f.id)) continue
      this.state.marketingQueue.push({
        id: f.id,
        feature: f.name,
        summary: f.summary,
        chips: f.chips,
        sha: f.sha,
        pr: f.pr,
        status: 'queued',
        at: f.at,
      })
      if (!prevIds.has(f.id)) added++
    }
    this.state.marketingQueue.sort((a, b) => {
      const rank = (s: MarketingNeed['status']) => (s === 'queued' ? 0 : s === 'posting' ? 1 : 2)
      const d = rank(a.status) - rank(b.status)
      return d !== 0 ? d : b.at - a.at
    })
    const pickOk = this.state.marketingQueue.some((q) => q.id === this.state.marketingPick && q.status === 'queued')
    if (!pickOk) this.state.marketingPick = this.state.marketingQueue.find((q) => q.status === 'queued')?.id ?? null
    this.emit()
    return added
  }

  private githubBusy = false
  private githubAnnounced = false

  private async scanGithub(repo?: string | null) {
    if (this.githubBusy) return
    this.githubBusy = true
    this.setNode('repo', 'acting', 'scanning github…')
    try {
      const scan = await fetchGithubScan(repo ?? this.state.github.repo)
      const added = this.applyGithubScan(scan)
      this.setNode('repo', 'idle')
      if (!scan.live) {
        if (!this.githubAnnounced) {
          this.log('product', 'Repo Agent', scan.error ?? 'GitHub off', ['needs token'])
          this.githubAnnounced = true
        }
        return
      }
      const announce = !this.githubAnnounced || added > 0
      this.githubAnnounced = true
      if (!announce) return
      this.llm('Repo Agent', 'OpenAI', 'gpt-5-mini', 0.004)
      this.log(
        'product',
        'Repo Agent',
        `GitHub scan — ${scan.commits.length} commits, ${scan.prs.length} PRs, ${scan.features.length} features on ${scan.repo}`,
        [scan.repo ?? 'repo'],
      )
      this.fire('repo>manifest', DEPT_COLOR.product)
      this.setNode('manifest', 'acting', 'queuing features…')
      await this.sleep(600)
      this.log(
        'product',
        'Manifest Builder',
        added > 0
          ? `Sent ${added} committed feature${added === 1 ? '' : 's'} to marketing`
          : `Marketing queue holds ${this.state.marketingQueue.filter((q) => q.status === 'queued').length} unposted features`,
        ['audience'],
      )
      this.llm('Manifest Builder', 'Anthropic', 'claude-haiku-4-5', 0.006)
      this.fire('manifest>ceo', DEPT_COLOR.product)
      this.setNode('manifest', 'idle')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.state.github.error = msg.slice(0, 180)
      this.setNode('repo', 'idle')
      this.setNode('manifest', 'idle')
      this.log('product', 'Repo Agent', `GitHub scan failed — ${this.state.github.error}`, ['error'])
      this.emit()
    } finally {
      this.githubBusy = false
    }
  }

  private async runGithubLoop() {
    await this.sleep(1200)
    await this.scanGithub()
    for (;;) {
      await this.sleep(45000)
      try {
        await this.scanGithub()
      } catch (e) {
        console.error('[engine] github scan failed, continuing:', e)
      }
    }
  }

  // ── Competition: tracker agents scan rivals on their own clock ──
  private async runCompetitionLoop() {
    await this.sleep(7000)
    for (;;) {
      try {
        await this.competitionScan()
      } catch (e) {
        console.error('[engine] competition scan failed, continuing:', e)
      }
      await this.sleep(13000)
    }
  }

  private async competitionScan() {
    const S = this.sleep.bind(this)
    const c = this.state.competitors[Math.floor(Math.random() * this.state.competitors.length)]
    c.status = 'scanning'
    this.emit()
    await S(2600)
    c.lastScanAt = Date.now()
    this.llm('Changelog Scout', 'OpenAI', 'gpt-5-mini', 0.003)

    const gaps = this.gapsFor(c)
    if (gaps.length) {
      const cap = gaps[0]
      c.status = 'reporting'
      const entry: IntelMove = {
        id: this.nextId++,
        at: Date.now(),
        comp: c.name,
        text: `has ${cap.label} — we don't`,
        counter: null,
      }
      this.state.intel.push(entry)
      if (this.state.intel.length > 12) this.state.intel.shift()
      this.log('alerts', 'Changelog Scout', `${c.name}: ${entry.text}`, ['matrix gap'])
      await S(1200)
      this.llm('Gap Analyst', 'Anthropic', 'claude-haiku-4-5', 0.008)
      entry.counter = 'product ship loop is revising the python SDK on GitHub'
      this.log('ceo', 'Orchestrator', `Counter to ${c.name}: ${entry.counter}`, [cap.label])
      c.status = 'watching'
      this.emit()
      return
    }

    // most scans find nothing — that's what watching looks like
    if (Math.random() >= 0.45) {
      c.threat = Math.max(0.05, c.threat - 0.01)
      c.status = 'watching'
      this.emit()
      return
    }

    // a move: prefer one whose capability they don't already have
    const options = COMPETITOR_MOVES.filter((m) => !m.capId || !c.capIds.includes(m.capId))
    const move = options[Math.floor(Math.random() * options.length)]
    if (move.capId) {
      c.capIds.push(move.capId)
      const cap = this.state.capabilities.find((x) => x.id === move.capId)
      if (cap) cap.flashAt = Date.now()
    }
    c.threat = Math.min(0.95, c.threat + move.threat)
    c.status = 'reporting'
    const entry: IntelMove = { id: this.nextId++, at: Date.now(), comp: c.name, text: move.text, counter: null }
    this.state.intel.push(entry)
    if (this.state.intel.length > 12) this.state.intel.shift()
    this.log('alerts', 'Changelog Scout', `${c.name}: ${move.text}`, ['changelog diff'])
    await S(2000)

    this.llm('Gap Analyst', 'Anthropic', 'claude-haiku-4-5', 0.008)
    entry.counter = COUNTERS[Math.floor(Math.random() * COUNTERS.length)]
    this.log('ceo', 'Orchestrator', `Counter to ${c.name}: ${entry.counter}`, [`threat ${(c.threat * 100).toFixed(0)}%`])
    c.status = 'watching'
    this.emit()
  }

  private gapsFor(c: Competitor): Capability[] {
    return c.capIds
      .map((id) => this.state.capabilities.find((x) => x.id === id))
      .filter((cap): cap is Capability => cap != null && !cap.ours && !this.shipCovers(cap.id))
  }

  private shipCovers(capId: string) {
    return this.state.shipJobs.some((j) => j.capId === capId && j.stage !== 'rejected' && j.stage !== 'blocked')
  }

  private shipHalted(job: ShipJob) {
    return job.stage === 'rejected' || job.stage === 'blocked'
  }

  private ownedByShip(name: string) {
    return this.state.shipJobs.some(
      (j) => j.feature === name && j.stage !== 'rejected' && j.stage !== 'blocked' && j.stage !== 'shipped',
    )
  }

  private openSdkShipJob(item: (typeof SDK_SHIPS)[number]): ShipJob {
    const intel: IntelMove = {
      id: this.nextId++,
      at: Date.now(),
      comp: item.rival,
      text: `research: ${item.name} — the python SDK is missing it`,
      counter: 'forwarded to product — Repo Agent shipping to GitHub',
    }
    this.state.intel.push(intel)
    if (this.state.intel.length > 12) this.state.intel.shift()
    this.log('alerts', 'Changelog Scout', `${item.rival}: ${intel.text}`, ['sdk gap'])
    return this.pushShipJob({
      capId: item.id,
      feature: item.name,
      summary: item.summary,
      rival: item.rival,
      brief: item.brief,
      file: item.file,
      intelId: intel.id,
    })
  }

  private pushShipJob(input: {
    capId: string
    feature: string
    summary: string
    rival: string
    brief: string
    file: string
    intelId: number
  }): ShipJob {
    const job: ShipJob = {
      id: this.nextId++,
      at: Date.now(),
      capId: input.capId,
      feature: input.feature,
      summary: input.summary,
      rival: input.rival,
      brief: input.brief,
      file: input.file,
      stage: 'researching',
      intelId: input.intelId,
      researchers: RESEARCHERS.map((r) => ({ ...r, status: 'queued' as const, note: null })),
      gate: blankShipGate(),
      pr: null,
      featureId: null,
    }
    this.state.shipJobs.push(job)
    if (this.state.shipJobs.length > 8) this.state.shipJobs.shift()
    this.emit()
    return job
  }

  private patchIntel(job: ShipJob, counter: string) {
    const row = this.state.intel.find((m) => m.id === job.intelId)
    if (row) row.counter = counter
  }

  private async runShipPipeline(job: ShipJob) {
    this.shipBusy = true
    const S = this.sleep.bind(this)
    try {
      const [scout, gap, writer] = job.researchers
      scout.status = 'working'
      scout.note = `${job.rival} · ${job.feature}`
      this.setNode('risk', 'acting', 'scanning rival…')
      this.emit()
      await S(1400)
      scout.status = 'done'
      scout.note = `${job.rival} has ${job.feature}`

      gap.status = 'working'
      this.setNode('risk', 'acting', 'diffing matrix…')
      this.llm('Gap Analyst', 'Anthropic', 'claude-haiku-4-5', 0.008)
      this.emit()
      await S(1600)
      gap.status = 'done'
      gap.note = `we do not have ${job.feature}`

      writer.status = 'working'
      this.setNode('manifest', 'acting', 'writing brief…')
      this.llm('Brief Writer', 'Anthropic', 'claude-haiku-4-5', 0.006)
      this.emit()
      await S(1500)
      writer.status = 'done'
      writer.note = 'brief forwarded to product'
      job.stage = 'briefed'
      this.log('alerts', 'Brief Writer', `Forwarded to product: build ${job.feature}`, [job.rival, 'brief'])
      this.setNode('risk', 'idle')
      this.setNode('manifest', 'idle')
      this.emit()

      await this.buildPullRequest(job)
      if (this.shipHalted(job)) return
      if (job.pr?.merged) {
        await this.mergeShip(job)
      } else if (job.pr) {
        job.gate.reason = job.pr.live
          ? (job.gate.reason ?? `PR #${job.pr.number} opened but not merged`)
          : (job.gate.reason ?? 'GitHub write skipped — token off')
        this.patchIntel(job, `PR #${job.pr.number} ready — not merged`)
        this.log('product', 'Repo Agent', job.gate.reason, [job.pr.file])
        this.emit()
      }
    } catch (e) {
      console.error('[engine] ship pipeline failed:', e)
      job.stage = 'blocked'
      const msg = e instanceof Error ? e.message.slice(0, 180) : String(e)
      job.gate.reason = job.gate.reason ?? msg
      this.emit()
    } finally {
      this.shipBusy = false
      this.setNode('terac', 'idle')
      this.setNode('repo', 'idle')
      this.setNode('manifest', 'idle')
      this.emit()
    }
  }

  private async buildPullRequest(job: ShipJob) {
    const S = this.sleep.bind(this)
    job.stage = 'building'
    this.setNode('repo', 'acting', `revising ${job.file}…`)
    this.llm('Repo Agent', 'OpenAI', 'gpt-5-mini', 0.004)
    this.emit()
    await S(1200)

    const result = await shipGithubFeature({
      slug: job.capId,
      name: job.feature,
      summary: job.summary,
      brief: job.brief,
      file: job.file,
    })

    if (!result.number) {
      job.stage = 'blocked'
      job.gate.reason = result.error ?? 'GitHub did not open a PR'
      this.log('product', 'Repo Agent', `Could not ship ${job.feature} — ${job.gate.reason}`, ['github'])
      this.patchIntel(job, `blocked — ${job.gate.reason}`)
      this.emit()
      return
    }

    const pr: AgentPr = {
      number: result.number,
      title: result.title,
      branch: result.branch,
      file: result.file,
      sha: result.sha.slice(0, 7) || hash7(),
      url: result.url,
      live: result.live,
      merged: result.merged,
    }
    job.pr = pr
    job.file = result.file
    this.ensureShipFeature(job)
    if (!result.merged) this.state.repo.openPRs += 1
    job.stage = 'pr-open'
    this.log(
      'product',
      'Repo Agent',
      result.merged
        ? `Opened and merged PR #${pr.number} — ${pr.title}`
        : `Opened PR #${pr.number} — ${pr.title}`,
      [pr.file, pr.sha, pr.branch],
    )
    this.fire('repo>manifest', DEPT_COLOR.product)
    this.setNode('repo', 'idle')
    this.setNode('manifest', 'acting', 'attaching receipts…')
    this.llm('Manifest Builder', 'Anthropic', 'claude-haiku-4-5', 0.006)
    await S(800)
    this.setNode('manifest', 'idle')
    if (result.error && result.merged === false) job.gate.reason = result.error
    this.emit()
  }

  private ensureShipFeature(job: ShipJob) {
    const existing = this.state.features.find((f) => f.name === job.feature || f.id === job.featureId)
    const pr = job.pr
    if (!pr) return
    if (existing) {
      existing.status = job.stage === 'shipped' || pr.merged ? 'shipped' : 'progress'
      existing.summary = job.summary
      existing.file = pr.file
      existing.chips = pr.merged
        ? [`PR #${pr.number}`, pr.file, pr.sha]
        : [`PR #${pr.number} · draft`, `branch: ${pr.branch}`, pr.sha]
      if (existing.status === 'shipped' && !existing.shippedAt) existing.shippedAt = Date.now()
      job.featureId = existing.id
      return
    }
    const f: Feature = {
      id: 'f' + this.nextFeatureId++,
      name: job.feature,
      summary: job.summary,
      status: 'progress',
      chips: [`PR #${pr.number} · draft`, `branch: ${pr.branch}`, pr.sha],
      file: pr.file,
    }
    this.state.features.push(f)
    job.featureId = f.id
  }

  private async runVerifyGate(job: ShipJob) {
    const pr = job.pr
    if (!pr) {
      job.stage = 'blocked'
      return
    }
    job.stage = 'hiring-verify'
    job.gate.status = 'hiring'
    this.setNode('terac', 'acting', 'hiring research→PR verifier…')
    this.fire('risk>terac', DEPT_COLOR.alerts)
    this.log('alerts', 'Terac Liaison', `Hiring a human to verify research → PR #${pr.number} (${job.feature})`, [
      'terac.com',
      `PR #${pr.number}`,
    ])
    this.emit()

    const hired = await hireShipReview({
      kind: 'verify',
      feature: job.feature,
      rival: job.rival,
      brief: job.brief,
      prTitle: pr.title,
      prNumber: pr.number,
      files: pr.file,
    })
    job.gate.live = hired.live
    job.gate.jobId = hired.jobId || null
    job.gate.quote = hired.quote
    job.gate.dashboardUrl = hired.dashboardUrl
    job.gate.reason = hired.reason

    if (hired.verdict === 'error') {
      job.stage = 'blocked'
      job.gate.status = 'error'
      this.teracShipBlocked = true
      this.log('alerts', 'Terac Liaison', `No verifier for PR #${pr.number} — ${hired.reason.slice(0, 90)}`, [
        hired.live ? 'hire failed' : 'needs key',
      ])
      this.patchIntel(job, `PR #${pr.number} blocked — Terac did not hire`)
      this.setNode('terac', 'idle')
      this.emit()
      return
    }

    job.stage = 'awaiting-verify'
    job.gate.status = 'waiting'
    this.log('alerts', 'Terac Liaison', `Opportunity live — does research → PR #${pr.number} hold up?`, [hired.jobId, 'live'])
    this.setNode('terac', 'acting', 'waiting on verifier…')
    this.emit()

    const v = await this.waitForShipVerdict(hired.jobId)
    job.gate.expert = v.expert
    job.gate.reason = v.reason
    if (v.verdict === 'approved') {
      job.gate.status = 'approved'
      job.gate.verdict = 'approved'
      this.log('alerts', 'Terac Liaison', `${v.expert ?? 'Terac expert'}: research → PR holds — ${v.reason.slice(0, 100)}`, [
        'verify',
      ])
      this.patchIntel(job, `PR #${pr.number} verified — shipping`)
    } else if (v.verdict === 'rejected') {
      job.gate.status = 'revised'
      job.gate.verdict = 'rejected'
      job.stage = 'rejected'
      this.log('alerts', 'Terac Liaison', `${v.expert ?? 'Terac expert'}: research → PR rejected — ${v.reason.slice(0, 100)}`, [
        'reject',
      ])
      this.patchIntel(job, `PR #${pr.number} rejected by Terac`)
    } else {
      job.stage = 'blocked'
      job.gate.status = 'error'
      job.gate.reason = v.reason
      this.log('alerts', 'Terac Liaison', v.reason, ['error'])
      this.patchIntel(job, `PR #${pr.number} blocked — waiting on Terac`)
    }
    this.setNode('terac', 'idle')
    this.emit()
  }

  private async mergeShip(job: ShipJob) {
    const pr = job.pr
    if (!pr) return
    const S = this.sleep.bind(this)
    this.setNode('repo', 'acting', `merging PR #${pr.number}…`)
    await S(1400)
    const feature =
      this.state.features.find((f) => f.id === job.featureId || f.name === job.feature) ??
      ({
        id: job.featureId ?? 'f' + this.nextFeatureId++,
        name: job.feature,
        summary: job.summary,
        status: 'progress' as const,
        chips: [],
        file: pr.file,
      } satisfies Feature)
    if (!this.state.features.includes(feature)) this.state.features.push(feature)
    feature.status = 'shipped'
    feature.shippedAt = Date.now()
    feature.chips = [`PR #${pr.number}`, pr.file, pr.sha]
    if (!pr.merged) this.state.repo.openPRs = Math.max(0, this.state.repo.openPRs - 1)

    const cap = this.state.capabilities.find((x) => x.id === job.capId || x.label === job.feature)
    if (cap) {
      if (!cap.ours) cap.flashAt = Date.now()
      cap.ours = true
    } else {
      this.state.capabilities.push({ id: job.capId, label: job.feature, ours: true, flashAt: Date.now() })
    }

    job.stage = 'shipped'
    if (pr) pr.merged = true
    this.log('product', 'Repo Agent', `Merged PR #${pr.number} — ${job.feature} is on main`, [pr.file, pr.sha])
    this.log('ceo', 'Orchestrator', `Shipped ${job.feature} — queued for marketing`, [`PR #${pr.number}`])
    this.patchIntel(job, `shipped via PR #${pr.number}`)
    this.queueShippedNeed(job, pr)
    this.setPipeline(job.feature, 1)
    this.fire('manifest>ceo', DEPT_COLOR.product)
    this.setNode('repo', 'idle')
    this.emit()
    this.timers.push(
      setTimeout(() => {
        void this.scanGithub()
      }, 2500),
    )
  }

  private queueShippedNeed(job: ShipJob, pr: AgentPr) {
    const id = `ship-${job.capId}`
    if (this.state.marketingQueue.some((q) => q.id === id || q.feature === job.feature)) return
    this.state.marketingQueue.unshift({
      id,
      feature: job.feature,
      summary: job.summary,
      chips: [`PR #${pr.number}`, pr.sha],
      sha: pr.sha,
      pr: pr.number,
      status: 'queued',
      at: Date.now(),
    })
    if (!this.state.marketingPick) this.state.marketingPick = id
  }

  private shipsThisSession = 0

  private async runProductShipLoop() {
    await this.sleep(9000 + Math.floor(Math.random() * 3000))
    for (;;) {
      try {
        if (this.shipsThisSession < MAX_SDK_SHIPS && !this.shipBusy) {
          const next = SDK_SHIPS.find((s) => !this.shipCovers(s.id))
          if (next) {
            const job = this.openSdkShipJob(next)
            await this.runShipPipeline(job)
            if (job.stage === 'shipped') this.shipsThisSession++
          }
        }
      } catch (e) {
        console.error('[engine] product ship failed, continuing:', e)
      }
      await this.sleep(180000)
    }
  }

  private async waitForShipVerdict(jobId: string): Promise<{
    verdict: 'approved' | 'rejected' | 'waiting' | 'error'
    reason: string
    expert: string | null
  }> {
    // The human is the gate. Poll until they answer; do not auto-approve.
    for (;;) {
      await this.sleep(12_000)
      try {
        const v = await pollShipReview(jobId)
        if (v.verdict !== 'waiting') return v
      } catch (e) {
        console.error('[engine] ship poll failed:', e)
      }
    }
  }

  // ── Real agent brains ──────────────────────────────────────────
  // Every successful call logs a REAL ledger row: actual provider, model,
  // tokens, and estimated cost. No call → no row.
  private llmReal(agent: string, r: { provider: string; model: string; tokensIn: number; tokensOut: number; costUsd: number }) {
    const provider = r.provider === 'anthropic' ? 'Anthropic' : r.provider === 'openai' ? 'OpenAI' : 'Google'
    this.state.llmCalls.push({
      id: this.nextId++,
      at: Date.now(),
      agent,
      provider,
      model: r.model,
      tokens: r.tokensIn + r.tokensOut,
      cost: r.costUsd,
    })
    if (this.state.llmCalls.length > 60) this.state.llmCalls.shift()
    this.state.spendToday += r.costUsd
    this.chargeCost(r.costUsd)
    this.emit()
  }

  private llmAvailable(): boolean {
    const l = this.state.llm
    return Boolean(l && (l.anthropic || l.openai || l.gemini))
  }

  private pickProvider(pref: LlmProvider): LlmProvider | null {
    const l = this.state.llm
    if (!l) return null
    if (l[pref]) return pref
    if (l.anthropic) return 'anthropic'
    if (l.openai) return 'openai'
    if (l.gemini) return 'gemini'
    return null
  }

  // ask a real model as a named agent; returns the reply text or null
  private async agentBrain(
    agent: string,
    pref: LlmProvider,
    system: string,
    prompt: string,
    maxTokens = 180,
    tier: 'cheap' | 'smart' = 'cheap',
  ): Promise<string | null> {
    const provider = this.pickProvider(pref)
    if (!provider) return null
    const r = await llmComplete({ provider, tier, system, prompt, maxTokens })
    if (!r || !r.live || r.error || !r.text.trim()) {
      if (r?.error) this.log('ceo', 'Orchestrator', `${agent} brain call failed — ${r.error.slice(0, 80)}`, ['llm'])
      return null
    }
    this.llmReal(agent, r)
    if (this.state.llm) {
      this.state.llm.callsUsed = r.callsUsed
    }
    return r.text.trim()
  }

  // ── Market feed bootstrap: real Alpaca crypto data with sim fallback ──
  private async initMarket() {
    const ids = this.state.assets.map((a) => a.id)
    try {
      const [bars, latest] = await Promise.all([fetchBars(ids), fetchLatestPrices(ids)])
      for (const a of this.state.assets) {
        const live = latest[a.id]
        if (live) a.price = live
        const closes = bars[a.id]
        if (closes && closes.length > 2) {
          a.history = closes.slice(-119)
          a.history.push(a.price)
        } else {
          // no bars (quiet market) — rescale the sim history to the real level
          const scale = a.price / a.history[a.history.length - 1]
          a.history = a.history.map((v) => v * scale)
        }
        a.changePct = (a.price / a.history[0] - 1) * 100
      }
      this.rebaseSeeds()
      this.state.marketFeed = 'live'
      this.log(
        'finance',
        'Market Desk',
        `Connected to Alpaca crypto feed — live BTC · ETH · SOL · DOGE · AVAX${ORDERS_ENABLED ? ' · paper orders armed' : ''}`,
        ['data.alpaca.markets'],
      )
    } catch {
      this.state.marketFeed = 'sim'
      this.log('finance', 'Market Desk', 'Alpaca feed unreachable — falling back to simulated prices')
    }
    this.emit()
  }

  // seeded demo positions were priced against fake levels — once the real
  // feed connects, re-anchor their entries to live prices (keeping one
  // winner and one honest loser) so P&L reads sane
  private rebaseSeeds() {
    for (const p of this.state.positions) {
      if (p.id >= 0) continue
      const a = this.state.assets.find((x) => x.id === p.assetId)
      if (!a) continue
      p.entry = a.price * (p.id === -601 ? 0.958 : 1.058)
      p.qty = p.cost / p.entry
    }
    const r = this.state.marketRounds.find((x) => x.id === -603)
    if (r?.winner) {
      const a = this.state.assets.find((x) => x.id === r.winner)
      if (a) r.entryPrice = a.price * 0.958
    }
  }

  // ── Investment: five desk agents predict, rank, and deploy capital ──
  private async runInvestmentLoop() {
    await this.sleep(14000)
    for (;;) {
      try {
        await this.marketRound()
      } catch (e) {
        console.error('[engine] market round failed, continuing:', e)
      }
      // real model calls run on a 5-minute cadence; sim can churn faster
      await this.sleep(LIVE_ONLY ? 300_000 : 32000)
    }
  }

  // recent momentum an agent would read off the chart, in %
  private momentum(a: Asset): number {
    const back = a.history[Math.max(0, a.history.length - 40)]
    return (a.price / back - 1) * 100
  }

  // fallback confidence when no expert answers: how many of the five agents
  // independently ranked the winner first
  private deskConfidence(round: MarketRound): { confidence: number; note: string } {
    const winner = round.winner!
    const symbol = this.state.assets.find((a) => a.id === winner)?.symbol ?? winner
    const agreeing = round.preds.filter((p) => {
      if (!p.roi) return false
      return Object.entries(p.roi).sort((a, b) => b[1] - a[1])[0][0] === winner
    }).length
    return {
      confidence: Math.min(30 + 14 * agreeing, 95),
      note: `${agreeing} of 5 agents ranked ${symbol} first`,
    }
  }

  private async runTradeGate(round: MarketRound, winAsset: Asset) {
    const gate = round.terac

    // real hires cost real money (~$12/study) — the desk makes exactly ONE
    // Terac call per session. Every later round reuses that expert's stated
    // confidence (labeled with its age) or desk consensus, no further calls.
    if (this.teracHiresUsed >= this.TERAC_HIRE_BUDGET) {
      const prior = this.lastExpertReading
      if (prior) {
        const mins = Math.max(1, Math.round((Date.now() - prior.at) / 60_000))
        gate.status = 'expert'
        gate.confidence = prior.confidence
        gate.expert = prior.expert
        gate.note = `${prior.note} · expert reading from ${mins}m ago — one hire per session`
      } else {
        const desk = this.deskConfidence(round)
        gate.status = 'desk'
        gate.confidence = desk.confidence
        gate.note = `${desk.note} · one Terac hire per session already used`
      }
      this.emit()
      return
    }
    this.teracHiresUsed++ // attempts count too — never an accidental second paid call

    gate.status = 'hiring'
    this.setNode('risk', 'acting', 'routing to Terac…')
    this.fire('ceo>risk', DEPT_COLOR.alerts)
    this.log('alerts', 'Risk Sentinel', `Trade routed to Terac — confidence check on the $${round.amount} ${winAsset.symbol} deploy`, ['terac.com'])
    this.emit()
    await this.sleep(800)
    this.setNode('risk', 'idle')
    this.setNode('terac', 'acting', 'hiring crypto expert…')
    this.fire('risk>terac', DEPT_COLOR.alerts)
    this.emit()

    const ranking = round
      .consensus!.map((c) => {
        const a = this.state.assets.find((x) => x.id === c.assetId)!
        return `${a.symbol} ${c.roi >= 0 ? '+' : ''}${c.roi.toFixed(1)}%`
      })
      .join(' · ')

    try {
      const hired = await hireTradeReview({
        symbol: winAsset.symbol,
        name: winAsset.name,
        amount: round.amount,
        roi: round.consensus![0].roi,
        ranking,
      })
      gate.live = hired.live
      gate.jobId = hired.jobId || null
      gate.quote = hired.quote
      gate.dashboardUrl = hired.dashboardUrl

      if (hired.status === 'error') {
        const desk = this.deskConfidence(round)
        gate.status = 'desk'
        gate.confidence = desk.confidence
        gate.note = `${desk.note} · ${hired.reason.startsWith('Terac') ? '' : 'Terac: '}${hired.reason.slice(0, 90)}`
        this.log('alerts', 'Terac Liaison', `No expert — desk consensus confidence ${desk.confidence}%. ${hired.reason.slice(0, 90)}`, [gate.live ? 'hire failed' : 'needs key'])
        this.setNode('terac', 'idle')
        this.emit()
        return
      }

      gate.status = 'waiting'
      this.log('alerts', 'Terac Liaison', `Opportunity live — waiting on expert confidence for ${winAsset.symbol}`, [hired.jobId, 'live'])
      this.setNode('terac', 'acting', 'waiting on expert…')
      this.emit()

      // give the expert ~30s with a handful of polls; the fill won't wait forever
      for (let i = 0; i < 4; i++) {
        await this.sleep(8000)
        try {
          const v = await pollTradeReview(hired.jobId)
          if (v.status === 'done') {
            if (v.confidence != null) {
              gate.status = 'expert'
              gate.confidence = v.confidence
              gate.expert = v.expert
              gate.note = v.reason
              this.lastExpertReading = { confidence: v.confidence, expert: v.expert, note: v.reason, at: Date.now() }
              this.log('alerts', 'Terac Liaison', `${v.expert ?? 'Terac expert'}: ${v.confidence}% confident — ${v.reason.slice(0, 100)}`, ['expert'])
            } else {
              const desk = this.deskConfidence(round)
              gate.status = 'desk'
              gate.confidence = desk.confidence
              gate.note = `${desk.note} · expert answered without a confidence bucket`
            }
            this.setNode('terac', 'idle')
            this.emit()
            return
          }
        } catch (e) {
          console.error('[terac] trade poll failed:', e)
        }
      }

      // expert still out — deploy on desk consensus, keep polling in background
      const desk = this.deskConfidence(round)
      gate.confidence = desk.confidence
      gate.note = `${desk.note} · expert still reviewing`
      this.log('alerts', 'Terac Liaison', `Expert still reviewing — deploying on desk consensus ${desk.confidence}%`, [gate.jobId ?? '', 'waiting'])
      this.startTradePoller(round)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const desk = this.deskConfidence(round)
      gate.status = 'desk'
      gate.confidence = desk.confidence
      gate.note = `${desk.note} · hire failed: ${msg.slice(0, 90)}`
      this.log('alerts', 'Terac Liaison', `Hire failed — desk consensus confidence ${desk.confidence}%`, ['error'])
    }
    this.setNode('terac', 'idle')
    this.emit()
  }

  private startTradePoller(round: MarketRound) {
    if (this.tradePoll) clearInterval(this.tradePoll)
    let polls = 0
    // sparing: one poll every 30s, give up after 10 minutes
    this.tradePoll = setInterval(() => {
      polls++
      if (polls > 20 || !round.terac.jobId || round.terac.status === 'expert') {
        if (this.tradePoll) clearInterval(this.tradePoll)
        this.tradePoll = null
        return
      }
      void pollTradeReview(round.terac.jobId)
        .then((v) => {
          if (v.status !== 'done' || v.confidence == null) return
          round.terac.status = 'expert'
          round.terac.confidence = v.confidence
          round.terac.expert = v.expert
          round.terac.note = v.reason
          this.lastExpertReading = { confidence: v.confidence, expert: v.expert, note: v.reason, at: Date.now() }
          this.log('alerts', 'Terac Liaison', `Expert confidence landed after the fill — ${v.confidence}%: ${v.reason.slice(0, 100)}`, ['expert'])
          if (this.tradePoll) {
            clearInterval(this.tradePoll)
            this.tradePoll = null
          }
          this.emit()
        })
        .catch((e) => console.error('[terac] trade poll failed:', e))
    }, 30000)
  }

  private async marketRound() {
    const S = this.sleep.bind(this)
    const round: MarketRound = {
      id: this.nextId++,
      at: Date.now(),
      preds: COMMITTEE.map((c) => ({ agent: c.agent, mono: c.mono, persona: c.persona, roi: null })),
      consensus: null,
      winner: null,
      amount: [250, 400, 500, 600][Math.floor(Math.random() * 4)],
      status: 'predicting',
      orderId: null,
      entryPrice: null,
      terac: { status: 'idle', live: false, jobId: null, dashboardUrl: null, quote: null, expert: null, confidence: null, note: null },
    }
    this.state.marketRounds.unshift(round)
    if (this.state.marketRounds.length > 8) this.state.marketRounds.pop()
    this.log('finance', 'Market Desk', 'Prediction round opened — 5 agents on BTC · ETH · SOL · DOGE · AVAX', ['Alpaca paper'])
    this.emit()

    // predictions land one agent at a time — real model calls when brains
    // are online (persona → provider), scripted formula otherwise
    const DESK_PROVIDER: Record<string, LlmProvider> = {
      Prudence: 'anthropic',
      Momentum: 'openai',
      Quant: 'anthropic',
      'Runway Guardian': 'gemini',
      'Yield Scout': 'openai',
    }
    const marketBrief = this.state.assets
      .map((a) => `${a.symbol}: $${a.price.toPrecision(6)} · trailing-window change ${a.changePct.toFixed(2)}% · recent momentum ${this.momentum(a).toFixed(2)}%`)
      .join('\n')
    for (const pred of round.preds) {
      await S(LIVE_ONLY ? 800 : 2000)
      let real: Record<string, number> | null = null
      if (this.llmAvailable()) {
        const text = await this.agentBrain(
          `Market Desk · ${pred.agent}`,
          DESK_PROVIDER[pred.agent] ?? 'anthropic',
          `You are ${pred.agent}, a ${pred.persona} crypto analyst on an autonomous company's investment desk. Real Alpaca market data follows. Reply with ONLY a JSON object mapping asset ids to your predicted 30-day ROI percent (numbers, may be negative): {"btc": n, "eth": n, "sol": n, "doge": n, "avax": n}`,
          `Live market data:\n${marketBrief}\n\nYour ${pred.persona} 30-day ROI predictions as JSON only.`,
          120,
        )
        const parsed = text ? extractJson(text) : null
        if (parsed) {
          const ids = this.state.assets.map((a) => a.id)
          const vals = ids.map((id) => Number(parsed[id]))
          if (vals.every((v) => Number.isFinite(v) && Math.abs(v) <= 500)) {
            real = Object.fromEntries(ids.map((id, i) => [id, vals[i]]))
          }
        }
      }
      if (real) {
        pred.roi = real
      } else {
        const st = DESK_STYLE[pred.agent]
        pred.roi = Object.fromEntries(
          this.state.assets.map((a) => {
            const bias = MAJORS.has(a.id) ? st.majorBias : st.altBias
            return [a.id, this.momentum(a) * st.mw + bias + (Math.random() - 0.5) * 2 * st.noise]
          }),
        )
        this.llm('Market Desk', 'Anthropic', 'claude-haiku-4-5', 0.007)
      }
      this.emit()
    }

    // consensus ranking: mean predicted ROI per asset, best first
    round.consensus = this.state.assets
      .map((a) => ({
        assetId: a.id,
        roi: round.preds.reduce((s, p) => s + (p.roi?.[a.id] ?? 0), 0) / round.preds.length,
      }))
      .sort((x, y) => y.roi - x.roi)
    round.winner = round.consensus[0].assetId
    round.status = 'ranked'
    const winAsset = this.state.assets.find((a) => a.id === round.winner)!
    this.log(
      'finance',
      'Market Desk',
      `Ranked: ${round.consensus.map((c) => `${this.state.assets.find((a) => a.id === c.assetId)!.symbol} ${c.roi >= 0 ? '+' : ''}${c.roi.toFixed(1)}%`).join(' · ')}`,
    )
    this.emit()
    await S(1800)

    // Terac gate: hire a human crypto expert to state confidence in the
    // trade before deploying — same shape as the audience claim-review gate
    await this.runTradeGate(round, winAsset)

    // deploy into the top-ranked asset — allocation moves Growth → Crypto,
    // so treasury allocations still sum exactly to cash
    const growth = this.state.treasury.alloc.find((a) => a.label === 'Growth')
    const crypto = this.state.treasury.alloc.find((a) => a.label === 'Crypto')
    if (!growth || !crypto || growth.amount < 50) {
      this.log('finance', 'Market Desk', 'Skipped deploy — growth allocation exhausted')
      return
    }
    const amount = Math.min(round.amount, growth.amount)
    growth.amount -= amount
    crypto.amount += amount
    round.entryPrice = winAsset.price

    // real paper order when keys are configured and the feed is live;
    // honest sim fill otherwise — the chip always says which one happened
    let fillChip = 'sim fill'
    if (ORDERS_ENABLED && this.state.marketFeed === 'live') {
      try {
        const order = await submitPaperOrder(winAsset.id, amount)
        round.orderId = order.id || 'alp_live'
        if (order.filledPrice) round.entryPrice = order.filledPrice
        fillChip = 'Alpaca paper order'
      } catch (e) {
        round.orderId = 'sim_' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')
        this.log('finance', 'Market Desk', `Alpaca rejected the order — recording simulated fill (${e instanceof Error ? e.message.slice(0, 60) : 'error'})`)
      }
    } else {
      round.orderId = 'sim_' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')
    }
    round.status = 'executed'
    this.state.positions.push({
      id: this.nextId++,
      at: Date.now(),
      assetId: winAsset.id,
      qty: amount / round.entryPrice,
      cost: amount,
      entry: round.entryPrice,
    })
    if (this.state.positions.length > 12) this.state.positions.shift()
    const confStr =
      round.terac.confidence != null
        ? ` · confidence ${round.terac.confidence}% (${round.terac.status === 'expert' ? 'Terac expert' : 'desk consensus'})`
        : ''
    this.log(
      'finance',
      'Market Desk',
      `Filled — BUY $${amount} ${winAsset.symbol} @ $${round.entryPrice.toLocaleString(undefined, { maximumFractionDigits: round.entryPrice < 1 ? 4 : 2 })}${confStr}`,
      [round.orderId, fillChip],
    )
    this.emit()
  }

  private async committeeRound() {
    const S = this.sleep.bind(this)
    const def = PROPOSAL_POOL[Math.floor(Math.random() * PROPOSAL_POOL.length)]
    const proposal: Proposal = {
      id: this.nextId++,
      at: Date.now(),
      title: def.title,
      detail: def.detail,
      amount: def.amount,
      kind: def.kind,
      status: 'voting',
      votes: COMMITTEE.map((c) => ({ agent: c.agent, mono: c.mono, persona: c.persona, verdict: null, reason: null })),
    }
    this.state.proposals.unshift(proposal)
    if (this.state.proposals.length > 12) this.state.proposals.pop()
    this.log('finance', 'Investment Committee', `Proposal on the table: ${def.title} — $${def.amount.toLocaleString()}`)
    this.emit()

    // votes land one at a time — the debate is the show
    for (let i = 0; i < proposal.votes.length; i++) {
      await S(2100)
      const member = COMMITTEE[i]
      const vote = proposal.votes[i]
      const approves = member.tolerance + (Math.random() - 0.5) * 0.25 > def.risk
      vote.verdict = approves ? 'approve' : 'reject'
      const pool = VOTE_REASONS[member.agent][approves ? 'approve' : 'reject']
      vote.reason = pool[Math.floor(Math.random() * pool.length)]
      this.llm('Investment Committee', 'Anthropic', 'claude-haiku-4-5', 0.006)
      this.emit()
    }

    const ayes = proposal.votes.filter((v) => v.verdict === 'approve').length
    proposal.status = ayes >= 3 ? 'approved' : 'rejected'
    this.log(
      'finance',
      'Investment Committee',
      `${proposal.status === 'approved' ? 'Approved' : 'Rejected'} ${ayes}–${proposal.votes.length - ayes}: ${def.title}`,
    )
    this.emit()

    if (proposal.status !== 'approved') return
    await S(1600)

    // execute against the treasury
    const t = this.state.treasury
    const from = t.alloc.find((a) => a.label === def.from)
    if (def.kind === 'allocate') {
      const to = t.alloc.find((a) => a.label === def.to)
      if (from && to) {
        const moved = Math.min(def.amount, from.amount)
        from.amount -= moved
        to.amount += moved
      }
    } else if (from) {
      const spent = Math.min(def.amount, from.amount)
      from.amount -= spent
      t.cash -= spent
    }
    proposal.status = 'executed'
    this.log('finance', 'Investment Committee', `Executed: ${def.title}`, [`$${def.amount.toLocaleString()}`])
    this.emit()
  }

  private reportText(p50: number): string {
    const fs = this.state.forecasters
    const lo = Math.min(...fs.map((f) => f.p50))
    const hi = Math.max(...fs.map((f) => f.p50))
    const spread = (((hi - lo) / p50) * 100).toFixed(1)
    const growth = (((p50 - this.modelMrr()) / Math.max(this.modelMrr(), 1)) * 100).toFixed(1)
    return (
      `The ensemble projects $${p50.toLocaleString()} MRR in 30 days (+${growth}%), with model estimates spanning ` +
      `$${lo.toLocaleString()}–$${hi.toLocaleString()}. Launch campaigns continue to produce measurable bumps within 48h of posting; ` +
      `the bear case assumes campaign fatigue in the AI Infra segment, while the churn-hawk flags usage decay in three Starter accounts. ` +
      `Confidence-weighted disagreement is ${spread}%, ${Number(spread) > 14 ? 'above' : 'within'} normal range.`
    )
  }

  private nextShippable(): Feature {
    const inProgress = this.state.features.find((f) => f.status === 'progress' && !this.ownedByShip(f.name))
    if (inProgress) return inProgress
    const item = BACKLOG[this.backlogIdx++ % BACKLOG.length]
    // if the backlog wrapped, retire the previous shipped card of the same name
    this.state.features = this.state.features.filter((f) => !(f.name === item.name && f.status === 'shipped'))
    const f: Feature = {
      id: 'f' + this.nextFeatureId++,
      name: item.name,
      summary: item.summary,
      status: 'progress',
      chips: [`PR #${this.nextPr++} · draft`, `branch: ${item.name.split(' ')[0].toLowerCase()}`],
      file: item.file,
    }
    this.state.features.push(f)
    return f
  }

  private async runAudienceCampaign(feature: string, camp: number): Promise<{ text: string; predicted: number }> {
    const S = this.sleep.bind(this)
    const sim = this.state.campaignSim
    sim.campaign = camp
    sim.feature = feature
    sim.winnerId = null
    sim.postedAt = null
    sim.drafts = blankDrafts()
    sim.votes = blankVotes()
    sim.terac = blankTerac()
    this.pendingPublish = null
    if (this.teracPoll) {
      clearInterval(this.teracPoll)
      this.teracPoll = null
    }
    sim.stage = 'queuing'
    sim.pulled = sim.total
    this.setPipeline(feature, 2)
    this.setNode('studio', 'acting', 'queuing 5 posts…')
    this.log('marketing', 'Writer Bench', `Start — queued 5 posts for @business_agent · ${feature}`, ['mock'])
    this.emit()
    await S(900)

    sim.stage = 'writing'
    this.setNode('studio', 'acting', '5 writers drafting…')
    this.fire('ceo>studio', DEPT_COLOR.ceo)
    this.emit()
    const WRITER_PROVIDER: Record<string, LlmProvider> = {
      Direct: 'anthropic',
      Receipts: 'openai',
      Operator: 'gemini',
      Narrative: 'anthropic',
      Hook: 'openai',
    }
    for (const d of sim.drafts) {
      d.status = 'writing'
      this.emit()
      await S(1100)
      let real: string | null = null
      if (this.llmAvailable()) {
        real = await this.agentBrain(
          d.agent,
          WRITER_PROVIDER[d.agent] ?? 'anthropic',
          `You are "${d.agent}", a copywriter agent at Business_Agent with a ${d.voice} voice. Write ONE post for the @business_agent X account announcing a just-committed feature of the AgentBasis python SDK (LLM observability). Under 240 characters. No hashtags, no emoji, no quotes around the post. Reply with the post text only.`,
          `Feature just committed: ${feature}`,
          120,
        )
        if (real) real = real.replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').slice(0, 270)
      }
      d.text = real ?? WRITER_COPY[d.agent](feature)
      d.status = 'ready'
      if (!real) this.llm(d.agent, 'Anthropic', 'claude-sonnet-5', 0.012)
      this.log('marketing', d.agent, `Queued post — ${d.voice} voice${real ? '' : ' (canned)'}`, ['@business_agent'])
      this.emit()
    }
    this.setNode('studio', 'idle')
    this.fire('studio>sim', DEPT_COLOR.marketing)

    sim.stage = 'voting'
    this.setNode('sim', 'acting', '9 jurors voting…')
    this.emit()
    const JURY_PROVIDERS: LlmProvider[] = ['anthropic', 'openai', 'gemini']
    let jurorIdx = 0
    for (const v of sim.votes) {
      await S(800)
      let realPick: { pick: number; reason: string } | null = null
      if (this.llmAvailable()) {
        const ballot = sim.drafts.map((d, i) => `${i + 1}. [${d.agent} · ${d.voice}] ${d.text}`).join('\n')
        const text = await this.agentBrain(
          `Juror ${v.handle}`,
          JURY_PROVIDERS[jurorIdx++ % JURY_PROVIDERS.length],
          `You are ${v.handle}, a real X follower of @business_agent from the "${v.cluster}" audience cluster. Pick the post you would actually engage with. Reply with ONLY JSON: {"pick": <1-${sim.drafts.length}>, "reason": "<under 10 words>"}`,
          `Ballot:\n${ballot}`,
          80,
        )
        const parsed = text ? extractJson(text) : null
        const n = parsed ? Number(parsed.pick) : NaN
        if (Number.isFinite(n) && n >= 1 && n <= sim.drafts.length) {
          realPick = { pick: sim.drafts[n - 1].id, reason: String(parsed.reason ?? '').slice(0, 60) }
        }
      }
      if (realPick) {
        v.pick = realPick.pick
        v.reason = realPick.reason
      } else {
        const preferred = AFFINITY[v.cluster]
        const pickAgent = Math.random() < 0.72 ? preferred : WRITERS[Math.floor(Math.random() * WRITERS.length)].agent
        const draft = sim.drafts.find((d) => d.agent === pickAgent) ?? sim.drafts[0]
        v.pick = draft.id
        const reasons = JURY_REASONS[v.cluster]
        v.reason = reasons[Math.floor(Math.random() * reasons.length)]
        this.llm('Persona Sim', 'Anthropic', 'claude-haiku-4-5', 0.004)
      }
      this.emit()
    }

    const winnerId = plurality(sim.votes)
    sim.winnerId = winnerId
    const winner = sim.drafts.find((d) => d.id === winnerId) ?? sim.drafts[0]
    const tally = sim.votes.filter((v) => v.pick === winner.id).length
    this.log('marketing', 'Persona Sim', `Jury ${tally}–${sim.votes.length - tally}: ${winner.agent} wins`, ['9 jurors'])
    this.fire('sim>studio', DEPT_COLOR.marketing, 1000)
    this.setNode('sim', 'idle')
    this.setPipeline(feature, 3)
    this.emit()
    await S(1000)

    await this.runTeracGate(feature, camp, winner, tally)
    return { text: winner.text ?? WRITER_COPY[winner.agent](feature), predicted: Math.round(80 + tally * 18) }
  }

  private async runTeracGate(feature: string, camp: number, winner: DraftPost, tally: number) {
    const S = this.sleep.bind(this)
    const sim = this.state.campaignSim
    const cluster = VOICE_CLUSTER[winner.agent] ?? 'infra'
    const expert = TERAC_EXPERTS[cluster]
    sim.stage = 'reviewing'
    if (this.teracHiresUsed >= this.TERAC_HIRE_BUDGET) {
      sim.terac = {
        status: 'error',
        jobId: null,
        expert: null,
        title: expert.title,
        quote: null,
        verdict: 'Session hire budget (1) already used — publishing without the human gate',
        live: false,
        dashboardUrl: null,
      }
      this.log('alerts', 'Terac Liaison', 'Hire budget (1/session) already used — publishing without the human gate', ['budget'])
      this.emit()
      await this.publishWinner(feature, camp, winner, tally)
      return
    }
    this.teracHiresUsed++
    sim.terac = {
      status: 'hiring',
      jobId: null,
      expert: null,
      title: expert.title,
      quote: null,
      verdict: null,
      live: false,
      dashboardUrl: null,
    }
    this.setNode('risk', 'acting', 'routing to Terac…')
    this.fire('ceo>risk', DEPT_COLOR.alerts)
    this.log('alerts', 'Risk Sentinel', `Winning draft routed to Terac — ${expert.title}`, ['terac.com'])
    this.emit()
    await S(800)
    this.setNode('risk', 'idle')
    this.setNode('terac', 'acting', 'opening opportunity…')
    this.fire('risk>terac', DEPT_COLOR.alerts)
    this.emit()

    try {
      const hired = await hireClaimReview({
        feature,
        post: winner.text ?? WRITER_COPY[winner.agent](feature),
        voice: winner.voice,
        clusterTitle: expert.title,
      })
      sim.terac.live = hired.live
      sim.terac.jobId = hired.jobId || null
      sim.terac.quote = hired.quote
      sim.terac.title = hired.title
      sim.terac.dashboardUrl = hired.dashboardUrl
      sim.terac.verdict = hired.reason
      if (hired.verdict === 'error') {
        sim.terac.status = 'error'
        this.log('alerts', 'Terac Liaison', hired.reason, ['needs key'])
        this.setNode('terac', 'idle')
        this.emit()
        await this.publishWinner(feature, camp, winner, tally)
        return
      }
      sim.terac.status = 'waiting'
      this.log('alerts', 'Terac Liaison', `Opportunity live — ${hired.reason}`, [hired.jobId, 'live'])
      this.setNode('terac', 'acting', 'waiting on expert…')
      this.emit()

      const first = await this.awaitTeracVerdict(hired.jobId, 3)
      if (first.verdict === 'waiting') {
        this.pendingPublish = { feature, camp, winner, tally }
        this.startTeracPoller(hired.jobId)
        return
      }
      if (first.verdict === 'approved' || first.verdict === 'revised') {
        this.applyTeracVerdict(winner, feature, first.verdict, first.reason, first.expert)
      } else {
        sim.terac.status = 'error'
        sim.terac.verdict = first.reason
        this.log('alerts', 'Terac Liaison', first.reason, ['error'])
        this.setNode('terac', 'idle')
        this.emit()
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      sim.terac.status = 'error'
      sim.terac.verdict = msg.slice(0, 180)
      this.log('alerts', 'Terac Liaison', `Hire failed — ${sim.terac.verdict}`, ['error'])
      this.setNode('terac', 'idle')
      this.emit()
    }
    await this.publishWinner(feature, camp, winner, tally)
  }

  private applyTeracVerdict(
    winner: DraftPost,
    feature: string,
    verdict: 'approved' | 'revised',
    reason: string,
    expert: string | null,
  ) {
    const sim = this.state.campaignSim
    sim.terac.expert = expert
    sim.terac.verdict = reason
    if (verdict === 'revised') {
      winner.text = `${feature} is live (PR merged). No waitlist — every plan, starting now.`
      sim.terac.status = 'revised'
    } else {
      sim.terac.status = 'approved'
    }
    this.log('alerts', 'Terac Liaison', `${expert ?? 'Terac expert'}: ${reason}`, [sim.terac.status])
    this.setNode('terac', 'idle')
    this.emit()
  }

  private async awaitTeracVerdict(jobId: string, attempts: number) {
    for (let i = 0; i < attempts; i++) {
      await this.sleep(12_000)
      try {
        const v = await pollClaimReview(jobId)
        if (v.verdict !== 'waiting') return v
      } catch (e) {
        console.error('[terac] poll failed:', e)
      }
    }
    return { verdict: 'waiting' as const, reason: 'Waiting on a Terac expert.', expert: null }
  }

  private startTeracPoller(jobId: string) {
    if (this.teracPoll) clearInterval(this.teracPoll)
    this.teracPoll = setInterval(() => {
      void pollClaimReview(jobId)
        .then((v) => {
          if (v.verdict === 'waiting' || !this.pendingPublish) return
          if (this.teracPoll) clearInterval(this.teracPoll)
          this.teracPoll = null
          const pending = this.pendingPublish
          this.pendingPublish = null
          if (v.verdict === 'approved' || v.verdict === 'revised') {
            this.applyTeracVerdict(pending.winner, pending.feature, v.verdict, v.reason, v.expert)
          } else {
            const sim = this.state.campaignSim
            sim.terac.status = 'error'
            sim.terac.verdict = v.reason
            this.log('alerts', 'Terac Liaison', v.reason, ['error'])
            this.setNode('terac', 'idle')
            this.emit()
          }
          void this.publishWinner(pending.feature, pending.camp, pending.winner, pending.tally)
        })
        .catch((e) => console.error('[terac] background poll failed:', e))
    }, 20_000)
    this.timers.push(this.teracPoll as unknown as ReturnType<typeof setTimeout>)
  }

  private async publishWinner(feature: string, camp: number, winner: DraftPost, tally: number) {
    const S = this.sleep.bind(this)
    const sim = this.state.campaignSim
    this.setNode('publisher', 'acting', 'posting to X…')
    this.fire('studio>publisher', DEPT_COLOR.marketing)
    await S(1400)
    this.log('marketing', 'Publisher', `Posted to X — ${winner.agent}'s draft · campaign #${camp}`, ['mock', 'x.com/status/…'])
    this.llm('Publisher', 'OpenAI', 'gpt-5-mini', 0.002)
    sim.stage = 'posted'
    sim.postedAt = Date.now()
    sim.busy = false
    this.setNode('publisher', 'idle')
    this.setPipeline(feature, 4)
    const posted = this.state.marketingQueue.find((q) => q.feature === feature && q.status === 'posting')
    if (posted) {
      posted.status = 'posted'
      posted.postedAt = Date.now()
    }
    this.state.marketingPick = this.state.marketingQueue.find((q) => q.status === 'queued')?.id ?? null
    this.emit()

    const predicted = Math.round(80 + tally * 18 + Math.random() * 24)
    const post: Post = {
      id: this.nextId++,
      at: Date.now(),
      campaign: camp,
      text: winner.text ?? WRITER_COPY[winner.agent](feature),
      predicted,
      actual: null,
    }
    this.state.posts.push(post)
    if (this.state.posts.length > 8) this.state.posts.shift()
    this.timers.push(
      setTimeout(() => {
        post.actual = Math.round(predicted * (0.72 + Math.random() * 0.55))
        this.emit()
      }, 9000 + Math.random() * 9000),
    )
  }

  private async runLoop() {
    // small pause before the first cycle so the floor is readable on load
    await this.sleep(2500)
    for (;;) {
      // one bad cycle skips — it must never kill the demo loop
      try {
        await this.cycle()
      } catch (e) {
        console.error('[engine] cycle failed, continuing:', e)
      }
      await this.sleep(9000)
    }
  }

  private async cycle() {
    const S = this.sleep.bind(this)

    // Product observes GitHub and does not ship. Fake merges only run
    // when GitHub is off, so the demo board still moves.
    if (!this.state.github.live) {
      const feature = this.nextShippable()
      if (this.ownedByShip(feature.name)) {
        // Terac pipeline owns this card — don't fake-merge it here
      } else {
      // the shipped PR number is the same one the draft carried — receipts must line up
      const draftChip = feature.chips.find((c) => /^PR #\d+/.test(c))
      const pr = draftChip ? parseInt(draftChip.slice(4), 10) : this.nextPr++
      const file = feature.file ?? `src/${feature.name.replace(/\s+/g, '-').toLowerCase()}.ts`

      // ── Product: detect the merge ──────────────────────────────
      this.setNode('repo', 'acting', 'scanning repo…')
      this.state.repo.lastScanAt = Date.now()
      await S(2200)
      this.log('product', 'Repo Agent', 'Scan complete — 3 new commits on main', [file])
      this.llm('Repo Agent', 'OpenAI', 'gpt-5-mini', 0.004)
      await S(900)
      this.log('product', 'Repo Agent', `Merged PR detected: ${feature.name}`, [`PR #${pr}`])
      this.fire('repo>manifest', DEPT_COLOR.product)
      this.setNode('repo', 'idle')
      this.setNode('manifest', 'acting', 'updating manifest…')
      await S(1800)

      // feature board: In Progress → Shipped, with receipts
      feature.status = 'shipped'
      feature.shippedAt = Date.now()
      feature.chips = [`PR #${pr}`, file, hash7()]
      // competition matrix: shipping a feature flips our capability cell
      const slug = feature.name.replace(/\s+/g, '-').toLowerCase()
      const cap = this.state.capabilities.find((x) => x.id === slug || x.label === feature.name)
      if (cap) {
        if (!cap.ours) cap.flashAt = Date.now()
        cap.ours = true
      } else {
        this.state.capabilities.push({ id: slug, label: feature.name, ours: true, flashAt: Date.now() })
        if (this.state.capabilities.length > 12) this.state.capabilities.shift()
      }
      // keep the Shipped column bounded — newest 8 cards only
      const shipped = this.state.features
        .filter((f) => f.status === 'shipped')
        .sort((a, b) => (b.shippedAt ?? 0) - (a.shippedAt ?? 0))
      if (shipped.length > 8) {
        const cut = new Set(shipped.slice(8).map((f) => f.id))
        this.state.features = this.state.features.filter((f) => !cut.has(f.id))
      }
      this.state.repo.openPRs = Math.max(1, this.state.repo.openPRs + (Math.random() < 0.5 ? -1 : 1))
      this.state.repo.commits.push(3 + Math.floor(Math.random() * 7))
      if (this.state.repo.commits.length > 14) this.state.repo.commits.shift()
      this.setPipeline(feature.name, 1)

      this.log('product', 'Manifest Builder', `Feature marked shipped: ${feature.name} — evidence attached`, [`PR #${pr}`, file])
      this.llm('Manifest Builder', 'Anthropic', 'claude-haiku-4-5', 0.006)
      this.fire('manifest>ceo', DEPT_COLOR.product)
      this.setNode('manifest', 'idle')

      // marketing is Start-driven on Audience — the ops loop does not auto-post
      this.setNode('ceo', 'thinking')
      await S(1800)
      this.log('ceo', 'Orchestrator', `Shipped ${feature.name} — campaign armed. Start on Audience to queue 5 posts.`)
      this.setNode('ceo', 'idle')

      this.timers.push(
        setTimeout(() => {
          if (this.state.pipeline?.feature === feature.name && this.state.pipeline.stage === 1) {
            this.state.pipeline = null
            this.emit()
          }
        }, 8000),
      )
      if (Math.random() < 0.65) this.nextShippable()
      }
    }

    // ── Revenue reacts ─────────────────────────────────────────
    await S(3500)
    this.payment()
    await S(4200)
    if (Math.random() < 0.75) this.payment()

    // ── Finance: forecast ──────────────────────────────────────
    this.fire('ledger>forecast', DEPT_COLOR.finance)
    this.setNode('forecast', 'acting', 'forecasting MRR…')
    await S(3000)
    this.runForecast()
    const p50 = this.forecastP50()
    const band = Math.round(p50 * 0.11)
    this.log(
      'finance',
      'Forecast Ensemble',
      `30d P50 MRR $${p50.toLocaleString()} · band $${(p50 - band).toLocaleString()}–$${(p50 + band).toLocaleString()}`,
      ['5 models', 'bull/bear/churn-hawk'],
    )
    this.llm('Forecast Ensemble', 'multi', 'ensemble ×5', 0.041)
    this.fire('forecast>ceo', DEPT_COLOR.finance)
    this.setNode('forecast', 'idle')
    await S(1400)

    // ── Loop closes ────────────────────────────────────────────
    this.state.loops++
    const dip = Math.random() < 0.4
    this.state.forecastNote = {
      text: this.reportText(p50),
      scheduled: dip ? this.state.campaigns + 1 : null,
      at: Date.now(),
    }
    this.emit()

    if (dip) {
      await S(1600)
      this.setNode('ceo', 'thinking')
      await S(2000)
      this.log('ceo', 'Orchestrator', 'Forecast dip in P10 band — scheduling follow-up campaign')
      this.setNode('ceo', 'idle')
    }
  }
}

// survive Vite HMR without doubling the loop
const g = globalThis as { __cockpitEngine?: Engine; __cockpitEngineGen?: number }
const ENGINE_GEN = 11
if (g.__cockpitEngineGen !== ENGINE_GEN) {
  g.__cockpitEngine = undefined
  g.__cockpitEngineGen = ENGINE_GEN
}
export const engine = g.__cockpitEngine ?? (g.__cockpitEngine = new Engine())
