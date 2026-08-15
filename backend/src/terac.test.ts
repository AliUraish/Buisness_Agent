import { describe, expect, it } from 'vitest'
import {
  opportunityBody,
  parseConfidence,
  parseVerdict,
  parseShipVerdict,
  formatTeracError,
  tradeOpportunityBody,
  shipOpportunityBody,
} from './terac.ts'

describe('parseVerdict', () => {
  it('reads Approve from the verdict screening answer', () => {
    const r = parseVerdict([
      { key: 'verdict', answer: 'Approve — post as written' },
      { key: 'notes', answer: 'PR is on main.' },
    ])
    expect(r.verdict).toBe('approved')
    expect(r.reason).toBe('PR is on main.')
  })

  it('reads Revise and uses the notes as the reason', () => {
    const r = parseVerdict([
      { key: 'verdict', answer: ['Revise — claims are too strong'] },
      { key: 'notes', answer: 'Drop the absolute.' },
    ])
    expect(r.verdict).toBe('revised')
    expect(r.reason).toBe('Drop the absolute.')
  })

  it('falls back to a default reason when notes are missing', () => {
    const r = parseVerdict([{ key: 'verdict', answer: 'Approve — post as written' }])
    expect(r.verdict).toBe('approved')
    expect(r.reason.length).toBeGreaterThan(10)
  })

  it('reads free-text notes from the verdict answer array', () => {
    const r = parseVerdict([
      { key: 'verdict', answer: ['Revise — claims are too strong', 'Drop the absolute.'] },
    ])
    expect(r.verdict).toBe('revised')
    expect(r.reason).toBe('Drop the absolute.')
  })
})

describe('opportunityBody', () => {
  it('gives every pick-one screener at least two answers', () => {
    const body = opportunityBody('p1', {
      feature: 'webhooks v2',
      post: 'shipped.',
      voice: 'direct',
      clusterTitle: 'infra reviewer',
    })
    for (const q of body.screening_questions) {
      expect(q.answers.length).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('parseConfidence', () => {
  it('maps each bucket to its midpoint', () => {
    const cases: [string, number][] = [
      ['High (75–100%)', 88],
      ['Medium (50–75%)', 62],
      ['Low (25–50%)', 38],
      ['Very low (0–25%)', 12],
    ]
    for (const [answer, expected] of cases) {
      const parsed = parseConfidence([{ key: 'confidence', answer }])
      expect(parsed.confidence).toBe(expected)
    }
  })

  it('uses the notes answer as the reason', () => {
    const parsed = parseConfidence([
      { key: 'confidence', answer: 'Medium (50–75%)' },
      { key: 'notes', answer: 'Momentum is real but the entry is late.' },
    ])
    expect(parsed.confidence).toBe(62)
    expect(parsed.reason).toBe('Momentum is real but the entry is late.')
  })

  it('returns null confidence when no bucket was answered', () => {
    const parsed = parseConfidence([{ key: 'notes', answer: 'no idea' }])
    expect(parsed.confidence).toBe(null)
  })
})

describe('tradeOpportunityBody', () => {
  it('carries symbol, amount, and ROI into the screener text', () => {
    const body = tradeOpportunityBody('proj_1', { symbol: 'BTC', name: 'Bitcoin', amount: 400, roi: 1.1, ranking: '1 BTC +1.1%' })
    const conf = body.screening_questions.find((q: any) => q.key === 'confidence')!
    expect(conf.text).toContain('$400')
    expect(conf.text).toContain('BTC')
    expect(conf.text).toContain('+1.1%')
    expect(conf.answers.length).toBe(4)
  })
})

describe('parseShipVerdict', () => {
  it('reads Approve as approved', () => {
    const r = parseShipVerdict([
      { key: 'verdict', answer: 'Approve — research and PR hold up, ship it' },
      { key: 'notes', answer: 'SSO gap is real and the PR covers SAML.' },
    ])
    expect(r.verdict).toBe('approved')
    expect(r.reason).toBe('SSO gap is real and the PR covers SAML.')
  })

  it('reads Reject as rejected', () => {
    const r = parseShipVerdict([{ key: 'verdict', answer: 'Reject — research or PR does not hold' }])
    expect(r.verdict).toBe('rejected')
  })
})

describe('shipOpportunityBody', () => {
  it('asks the expert to verify research and the PR together', () => {
    const body = shipOpportunityBody('p1', {
      kind: 'verify',
      feature: 'SSO',
      rival: 'Loopwork',
      brief: 'Loopwork shipped SSO. We do not have it.',
      prTitle: 'feat(sso): SAML + OIDC',
      prNumber: 81,
      files: 'src/auth/sso.ts',
    })
    const verdict = body.screening_questions.find((q: any) => q.key === 'verdict')!
    expect(body.title).toMatch(/research→PR/)
    expect(verdict.text).toContain('#81')
    expect(verdict.text).toContain('Loopwork shipped SSO')
    expect(verdict.answers[0].text).toMatch(/Approve/)
    expect(verdict.answers[1].text).toMatch(/Reject/)
    expect(body.description).toContain('src/auth/sso.ts')
  })
})

describe('formatTeracError', () => {
  it('reads Cloudflare-style nested error.message', () => {
    const msg = formatTeracError(429, { error: { code: '429', message: 'Too Many Requests' } }, '')
    expect(msg).toBe('Terac 429: Too Many Requests')
  })
})
