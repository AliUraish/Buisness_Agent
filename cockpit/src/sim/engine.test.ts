import { describe, expect, it } from 'vitest'
import { AUDIENCE } from '../data/audience'
import { engine, DEPT_COLOR, AGENT_DEPT, BOOT_MRR, ENGINEERS, JURY, JURY_QUOTAS, LIVE_ONLY, MAX_SDK_SHIPS, SDK_SHIPS, SHIP_TERAC_ARMED, seedBugChecks, seedLedgers, seedMarket, seedSupport, teracVerifyLabel, deskPnl } from './engine'
import { ALPACA_SYMBOL, shouldHarvest } from './alpaca'
import { CREDIT_BOOT, CREDIT_LOW, CREDIT_MAX_BUYS, shouldBuyCredits } from './credits'

describe('engine seed state', () => {
  it('live-only mode boots with no fabricated features or history', () => {
    expect(LIVE_ONLY).toBe(true)
    expect(engine.state.features).toEqual([])
    expect(engine.state.feed).toEqual([])
    expect(engine.state.mrr).toBe(0)
    expect(engine.state.spendToday).toBe(0)
  })

  it('has an accent color for every department', () => {
    for (const d of ['product', 'marketing', 'finance', 'ceo', 'alerts'] as const) {
      expect(DEPT_COLOR[d]).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('ledger seed state (sim generator, unused in live-only)', () => {
  const SIM = seedLedgers()

  it('live-only boots with empty ledgers', () => {
    expect(engine.state.transactions).toEqual([])
    expect(engine.state.llmCalls).toEqual([])
    expect(engine.state.posts).toEqual([])
  })

  it('transaction running balances are consistent and end at boot MRR', () => {
    const txs = SIM.transactions
    expect(txs.length).toBeGreaterThan(0)
    for (let i = 1; i < txs.length; i++) {
      expect(txs[i].balance).toBe(txs[i - 1].balance + txs[i].amount)
    }
    expect(txs[txs.length - 1].balance).toBe(BOOT_MRR)
  })

  it('generator spendToday equals the sum of its LLM rows', () => {
    const sum = SIM.llmCalls.reduce((a, c) => a + c.cost, 0)
    expect(SIM.spendToday).toBeCloseTo(sum, 6)
  })

  it('every seeded LLM agent bills to a known department', () => {
    for (const c of SIM.llmCalls) {
      expect(AGENT_DEPT[c.agent]).toBeDefined()
    }
  })

  it('seeded posts include at least one honest miss (actual < predicted)', () => {
    const withActual = SIM.posts.filter((p) => p.actual != null)
    expect(withActual.length).toBeGreaterThan(0)
    expect(withActual.some((p) => p.actual! < p.predicted)).toBe(true)
    expect(withActual.some((p) => p.actual! >= p.predicted)).toBe(true)
  })
})

describe('competition + investment seed state', () => {
  it('every competitor capability id exists in the matrix', () => {
    const capIds = new Set(engine.state.capabilities.map((c) => c.id))
    for (const comp of engine.state.competitors) {
      for (const id of comp.capIds) expect(capIds.has(id)).toBe(true)
    }
  })

  it('our matrix column matches shipped features at boot', () => {
    const shipped = new Set(engine.state.features.filter((f) => f.status === 'shipped').map((f) => f.name))
    for (const cap of engine.state.capabilities) {
      if (cap.ours) expect(shipped.has(cap.label)).toBe(true)
    }
  })

  it('threat levels stay within [0, 1]', () => {
    for (const c of engine.state.competitors) {
      expect(c.threat).toBeGreaterThanOrEqual(0)
      expect(c.threat).toBeLessThanOrEqual(1)
    }
  })

  it('treasury allocations sum exactly to cash', () => {
    const t = engine.state.treasury
    expect(t.alloc.reduce((a, x) => a + x.amount, 0)).toBe(t.cash)
  })

  it('every proposal carries a full five-member committee vote', () => {
    for (const p of engine.state.proposals) {
      expect(p.votes.length).toBe(5)
      expect(new Set(p.votes.map((v) => v.agent)).size).toBe(5)
    }
  })

  it('live-only boots with no fabricated committee history', () => {
    expect(engine.state.proposals).toEqual([])
  })

  it('boots with an empty ship pipeline — research has not forwarded yet', () => {
    expect(engine.state.shipJobs).toEqual([])
  })

  it('bills Changelog Scout, Gap Analyst, and Brief Writer to alerts', () => {
    expect(AGENT_DEPT['Changelog Scout']).toBe('alerts')
    expect(AGENT_DEPT['Gap Analyst']).toBe('alerts')
    expect(AGENT_DEPT['Brief Writer']).toBe('alerts')
  })

  it('hires Terac on the ship loop — humans review the PR before merge', () => {
    expect(SHIP_TERAC_ARMED).toBe(true)
  })

  it('labels a ship job Terac verified / not verified / reviewing', () => {
    const idle = { status: 'idle' as const, jobId: null, expert: null, quote: null, live: false, dashboardUrl: null, verdict: null, reason: null }
    expect(teracVerifyLabel({ gate: idle, pr: null })).toBeNull()
    expect(teracVerifyLabel({ gate: { ...idle, status: 'hiring' }, pr: { number: 1, title: 'x', branch: 'b', file: 'f', sha: 'abc' } })).toBe('reviewing')
    expect(teracVerifyLabel({ gate: { ...idle, status: 'waiting' }, pr: { number: 1, title: 'x', branch: 'b', file: 'f', sha: 'abc' } })).toBe('reviewing')
    expect(teracVerifyLabel({ gate: { ...idle, verdict: 'approved' }, pr: { number: 1, title: 'x', branch: 'b', file: 'f', sha: 'abc' } })).toBe('verified')
    expect(teracVerifyLabel({ gate: { ...idle, verdict: 'rejected' }, pr: { number: 1, title: 'x', branch: 'b', file: 'f', sha: 'abc' } })).toBe('not-verified')
    expect(teracVerifyLabel({ gate: idle, pr: { number: 1, title: 'x', branch: 'b', file: 'f', sha: 'abc' } })).toBe('not-verified')
  })

  it('ships unique notes under product/ on AliUraish/Buisness_Agent, capped per session', () => {
    expect(MAX_SDK_SHIPS).toBe(4)
    expect(SDK_SHIPS.length).toBe(MAX_SDK_SHIPS)
    const files = SDK_SHIPS.map((s) => s.file)
    expect(new Set(files).size).toBe(files.length)
    for (const s of SDK_SHIPS) {
      expect(s.file.startsWith('product/')).toBe(true)
      expect(s.file.endsWith('.md')).toBe(true)
    }
  })

  it('at least one rival has a capability we do not — research has a gap to forward', () => {
    const ours = new Set(engine.state.capabilities.filter((c) => c.ours).map((c) => c.id))
    const gaps = engine.state.competitors.flatMap((c) => c.capIds.filter((id) => !ours.has(id)))
    expect(gaps.length).toBeGreaterThan(0)
  })
})

describe('market desk seed state', () => {
  it('tracks exactly five assets: BTC ETH SOL DOGE AVAX', () => {
    expect(engine.state.assets.map((a) => a.symbol)).toEqual(['BTC', 'ETH', 'SOL', 'DOGE', 'AVAX'])
  })

  it('price histories are finite, positive, and end at the live price', () => {
    for (const a of engine.state.assets) {
      expect(a.history.length).toBeGreaterThanOrEqual(100)
      for (const v of a.history) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThan(0)
      }
      expect(a.history[a.history.length - 1]).toBeCloseTo(a.price, 8)
    }
  })

  it('crypto allocation equals open positions at cost — treasury still sums to cash', () => {
    const crypto = engine.state.treasury.alloc.find((a) => a.label === 'Crypto')
    expect(crypto).toBeDefined()
    const cost = engine.state.positions.reduce((s, p) => s + p.cost, 0)
    expect(crypto!.amount).toBeCloseTo(cost, 6)
  })

  it('position quantities reconcile with entry price and cost', () => {
    for (const p of engine.state.positions) {
      expect(p.qty * p.entry).toBeCloseTo(p.cost, 6)
      expect(engine.state.assets.some((a) => a.id === p.assetId)).toBe(true)
    }
  })

  it('sim generator round is executed on the highest-consensus asset with all five predictions in', () => {
    const round = seedMarket().round
    expect(round.status).toBe('executed')
    expect(round.preds.length).toBe(5)
    expect(round.preds.every((p) => p.roi != null && Object.keys(p.roi).length === 5)).toBe(true)
    expect(round.consensus![0].assetId).toBe(round.winner)
    const sorted = [...round.consensus!].sort((a, b) => b.roi - a.roi)
    expect(round.consensus).toEqual(sorted)
  })

  it('every asset maps to an Alpaca crypto symbol', () => {
    for (const a of engine.state.assets) {
      expect(ALPACA_SYMBOL[a.id]).toMatch(/^[A-Z]+\/USD$/)
    }
  })

  it('harvests a paper position after a 0.3% gain or a 90s hold', () => {
    expect(shouldHarvest(10_000, 400, 420)).toBe(false)
    expect(shouldHarvest(30_000, 400, 400.8)).toBe(false)
    expect(shouldHarvest(30_000, 400, 402)).toBe(true)
    expect(shouldHarvest(90_000, 400, 399)).toBe(true)
  })

  it('desk P&L is realized plus open mark', () => {
    expect(deskPnl([{ qty: 2, cost: 200, assetId: 'eth' }], [{ id: 'eth', price: 120 }], 10)).toBe(50)
  })

  it('sim generator round carries an honest trade-confidence gate', () => {
    const gate = seedMarket().round.terac
    expect(gate.status).toBe('desk') // seeded history hired no expert — says so
    expect(gate.confidence).toBeGreaterThanOrEqual(0)
    expect(gate.confidence).toBeLessThanOrEqual(100)
    expect(gate.note).toContain('of 5 agents')
  })
})

describe('support seed state (sim generator, unused in live-only)', () => {
  const TICKETS = seedSupport()

  it('live-only boots with an empty inbox', () => {
    expect(engine.state.tickets).toEqual([])
    expect(engine.state.paymentLink).toBeNull()
  })

  it('resolved tickets carry a CSAT score and a first-response time', () => {
    const resolved = TICKETS.filter((t) => t.status === 'resolved')
    expect(resolved.length).toBeGreaterThan(0)
    for (const t of resolved) {
      expect(t.csat).toBeGreaterThanOrEqual(1)
      expect(t.csat).toBeLessThanOrEqual(5)
      expect(t.firstResponseMs).toBeGreaterThan(0)
    }
  })

  it('seeded ratings include an honest middling CSAT, not all fives', () => {
    const rated = TICKETS.filter((t) => t.csat != null)
    expect(rated.some((t) => t.csat! < 4)).toBe(true)
    expect(rated.some((t) => t.csat! === 5)).toBe(true)
  })

  it('churn risk is escalated to the human queue with no auto-reply', () => {
    const esc = TICKETS.find((t) => t.status === 'escalated')
    expect(esc).toBeDefined()
    expect(esc!.topic).toBe('churn-risk')
    expect(esc!.msgs.every((m) => m.from === 'customer')).toBe(true)
  })

  it('phone numbers are masked — no raw digits beyond the tail', () => {
    for (const t of TICKETS) {
      expect(t.phone).toMatch(/^\+1 ·· ?· ·· \d{3}$/)
    }
  })

  it('every conversation starts with the customer, ordered by time', () => {
    for (const t of TICKETS) {
      expect(t.msgs[0].from).toBe('customer')
      for (let i = 1; i < t.msgs.length; i++) {
        expect(t.msgs[i].at).toBeGreaterThanOrEqual(t.msgs[i - 1].at)
      }
    }
  })

  it('support agents bill to a known department', () => {
    for (const a of ['Support Triage', 'Support Writer', 'Support QA']) {
      expect(AGENT_DEPT[a]).toBeDefined()
    }
  })
})

describe('bug checks (support → product)', () => {
  it('the engineer pool covers Anthropic, Google, and OpenAI', () => {
    expect(ENGINEERS.map((e) => e.provider).sort()).toEqual(['Anthropic', 'Google', 'OpenAI'])
  })

  it('every seeded check was run by an agent from the pool', () => {
    for (const b of seedBugChecks()) {
      expect(ENGINEERS.some((e) => e.name === b.agent.name && e.model === b.agent.model)).toBe(true)
    }
  })

  it('confirmed checks carry file/commit receipts; misses carry none', () => {
    const confirmed = seedBugChecks().filter((b) => b.verdict === 'confirmed')
    expect(confirmed.length).toBeGreaterThan(0)
    for (const b of confirmed) {
      expect(b.chips.length).toBeGreaterThan(0)
      expect(b.finding).toBeTruthy()
    }
  })

  it('seeded checks include an honest not-reproduced verdict', () => {
    expect(seedBugChecks().some((b) => b.verdict === 'not-reproduced')).toBe(true)
    expect(engine.state.bugChecks).toEqual([]) // live-only boots empty
  })

  it('the Bug Checker bills to product', () => {
    expect(AGENT_DEPT['Bug Checker']).toBe('product')
  })
})

describe('bank + rails (finance)', () => {
  it('Perflo opens with no simulated balance — sim is off', () => {
    const b = engine.state.bank
    expect(b.name).toBe('Perflo')
    expect(b.live).toBe(false)
    expect(b.balance).toBe(0)
    expect(engine.state.funding.source).toBe('stripe') // costs → Stripe until Perflo is live
  })

  it('allocation percentages always sum to exactly 100', () => {
    const sum = engine.state.bank.alloc.reduce((a, x) => a + x.pct, 0)
    expect(sum).toBe(100)
    for (const a of engine.state.bank.alloc) expect(a.pct).toBeGreaterThan(0)
  })

  it('the allocation covers the business: taxes, marketing, investment, payroll', () => {
    const labels = engine.state.bank.alloc.map((a) => a.label.toLowerCase()).join(' ')
    for (const needed of ['tax', 'marketing', 'investment', 'payroll']) {
      expect(labels).toContain(needed)
    }
  })

  it('Dodo is gone — only Stripe and Whop rails remain', () => {
    expect(Object.keys(engine.state.railTotals).sort()).toEqual(['Alpaca', 'Stripe', 'Whop'])
    expect(engine.state.tradingRevenue).toBe(0)
    for (const t of engine.state.transactions) {
      expect(['Stripe', 'Whop']).toContain(t.rail)
    }
  })

  it('the CFO Agent bills to finance', () => {
    expect(AGENT_DEPT['CFO Agent']).toBe('finance')
    expect(AGENT_DEPT['Credit Buyer']).toBe('finance')
  })

  it('Credit Buyer purchases when the mock pool is low', () => {
    expect(engine.state.credits.balance).toBe(CREDIT_BOOT)
    expect(shouldBuyCredits({ balance: CREDIT_LOW, bought: 0 })).toBe(true)
    expect(shouldBuyCredits({ balance: CREDIT_LOW + 1, bought: 0 })).toBe(false)
    expect(shouldBuyCredits({ balance: 0, bought: CREDIT_MAX_BUYS })).toBe(false)
  })
})

describe('forecastP50', () => {
  it('returns a confidence-weighted mean strictly inside the prediction range', () => {
    engine.state.forecasters = [
      { model: 'A', mono: 'A', persona: 'Bull', p50: 5000, confidence: 0.9, rationale: '' },
      { model: 'B', mono: 'B', persona: 'Bear', p50: 3000, confidence: 0.1, rationale: '' },
    ]
    const p50 = engine.forecastP50()
    expect(p50).toBeGreaterThan(3000)
    expect(p50).toBeLessThan(5000)
    // 0.9 weight on 5000 pulls the merge well above the midpoint
    expect(p50).toBeGreaterThan(4000)
    expect(p50).toBe(Math.round((5000 * 0.9 + 3000 * 0.1) / 1.0))
  })

  it('falls back to a growth estimate when no forecasters have run', () => {
    engine.state.forecasters = []
    // live-only anchors the model view at BOOT_MRR (real MRR can be $0)
    expect(engine.forecastP50()).toBe(Math.round(Math.max(engine.state.mrr, BOOT_MRR) * 1.09))
  })
})

describe('audience campaign sim', () => {
  it('seats exactly nine jurors from the five clusters at the advertised quotas', () => {
    expect(JURY.length).toBe(9)
    expect(new Set(JURY.map((j) => j.followerId)).size).toBe(9)
    for (const [cluster, n] of JURY_QUOTAS) {
      expect(JURY.filter((j) => j.cluster === cluster).length).toBe(n)
    }
  })

  it('jurors are the highest-engagement followers in their cluster', () => {
    for (const seat of JURY) {
      const f = AUDIENCE.followers[seat.followerId]
      expect(f.handle).toBe(seat.handle)
      const unseatedHigher = AUDIENCE.followers.filter(
        (x) => x.cluster === seat.cluster && x.engagement > f.engagement && !JURY.some((j) => j.followerId === x.id),
      )
      expect(unseatedHigher.length).toBe(0)
    }
  })

  it('boot sim is idle with five queued drafts, nine empty votes, and Terac idle', () => {
    const sim = engine.state.campaignSim
    expect(sim.stage).toBe('idle')
    expect(sim.busy).toBe(false)
    expect(sim.drafts.length).toBe(5)
    expect(sim.drafts.every((d) => d.status === 'queued' && d.text == null)).toBe(true)
    expect(sim.votes.length).toBe(9)
    expect(sim.votes.every((v) => v.pick == null && v.handle.startsWith('@'))).toBe(true)
    expect(sim.terac.status).toBe('idle')
    expect(sim.terac.live).toBe(false)
    expect(sim.winnerId).toBe(null)
  })

  it('startCampaign refuses when a round is already running', () => {
    engine.state.campaignSim.busy = true
    expect(engine.startCampaign()).toBe(false)
    engine.state.campaignSim.busy = false
  })

  it('every seated juror is a real mock follower', () => {
    for (const v of engine.state.campaignSim.votes) {
      expect(AUDIENCE.followers[v.followerId].handle).toBe(v.handle)
    }
  })
})

describe('github marketing queue', () => {
  it('applyGithubScan puts committed features on the board and into the audience queue', () => {
    const prevFeatures = engine.state.features
    const prevQueue = engine.state.marketingQueue
    const prevPick = engine.state.marketingPick
    const prevGithub = engine.state.github
    const prevRepo = engine.state.repo
    const t = Date.now()
    engine.applyGithubScan({
      live: true,
      repo: 'AliUraish/Agentalize',
      login: 'AliUraish',
      lastScanAt: t,
      error: null,
      commits: [],
      prs: [],
      features: [
        {
          id: 'g-livedata',
          name: 'LiveDataScreens',
          summary: 'real-time display',
          chips: ['aafa277'],
          sha: 'aafa277',
          pr: null,
          at: t,
          commitCount: 1,
        },
        {
          id: 'g-invest',
          name: 'Investigations',
          summary: 'investigations screen',
          chips: ['0ca7a4d'],
          sha: '0ca7a4d',
          pr: null,
          at: t - 1,
          commitCount: 1,
        },
      ],
      commitsPerDay: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
      openPRs: 0,
      repos: [{ fullName: 'AliUraish/Agentalize', pushedAt: t, private: false }],
    })
    expect(engine.state.github.live).toBe(true)
    expect(engine.state.features.map((f) => f.name)).toEqual(['LiveDataScreens', 'Investigations'])
    expect(engine.state.features.every((f) => f.status === 'progress')).toBe(true)
    expect(engine.state.marketingQueue.map((q) => q.feature)).toEqual(['LiveDataScreens', 'Investigations'])
    expect(engine.state.marketingQueue.every((q) => q.status === 'queued')).toBe(true)
    expect(engine.state.marketingPick).toBe('g-livedata')
    engine.selectMarketingNeed('g-invest')
    expect(engine.state.marketingPick).toBe('g-invest')
    engine.applyGithubScan(engine.state.github)
    expect(engine.state.marketingQueue.filter((q) => q.id === 'g-livedata')).toHaveLength(1)
    engine.state.features = prevFeatures
    engine.state.marketingQueue = prevQueue
    engine.state.marketingPick = prevPick
    engine.state.github = prevGithub
    engine.state.repo = prevRepo
  })

  it('does not re-queue a feature that marketing already posted', () => {
    const prevQueue = engine.state.marketingQueue
    const prevPick = engine.state.marketingPick
    const prevGithub = engine.state.github
    const prevFeatures = engine.state.features
    engine.state.marketingQueue = [
      {
        id: 'g-livedata',
        feature: 'LiveDataScreens',
        summary: 'real-time display',
        chips: ['aafa277'],
        sha: 'aafa277',
        pr: null,
        status: 'posted',
        at: 1,
        postedAt: 2,
      },
    ]
    engine.applyGithubScan({
      ...engine.state.github,
      live: true,
      repo: 'AliUraish/Agentalize',
      lastScanAt: Date.now(),
      features: [
        {
          id: 'g-livedata',
          name: 'LiveDataScreens',
          summary: 'real-time display',
          chips: ['aafa277'],
          sha: 'aafa277',
          pr: null,
          at: Date.now(),
          commitCount: 1,
        },
      ],
    })
    expect(engine.state.marketingQueue).toHaveLength(1)
    expect(engine.state.marketingQueue[0].status).toBe('posted')
    engine.state.marketingQueue = prevQueue
    engine.state.marketingPick = prevPick
    engine.state.github = prevGithub
    engine.state.features = prevFeatures
  })
})
