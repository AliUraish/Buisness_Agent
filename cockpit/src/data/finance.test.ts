import { describe, expect, it } from 'vitest'
import { buildHistory, PAST_CAMPAIGNS } from './finance'

describe('buildHistory', () => {
  it('produces 31 points (30 days ago through now) ending exactly at the target', () => {
    const h = buildHistory(3841)
    expect(h.length).toBe(31)
    expect(h[h.length - 1]).toBeCloseTo(3841, 6)
  })

  it('is deterministic across calls — the demo chart never jumps', () => {
    expect(buildHistory(3841)).toEqual(buildHistory(3841))
  })

  it('shows a revenue bump after each past campaign', () => {
    const h = buildHistory(3841)
    for (const c of PAST_CAMPAIGNS) {
      const idx = 30 - c.day // history index of the campaign day
      const before = h[idx] - h[idx - 1] // drift the day before
      const bumpWindow = h[idx + c.bumpDays] - h[idx]
      // the post-campaign window should clearly outpace ambient drift
      expect(bumpWindow).toBeGreaterThan(before + c.bump * 0.5)
    }
  })

  it('never produces NaN or negative revenue', () => {
    const h = buildHistory(3841)
    for (const v of h) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThan(0)
    }
  })
})
