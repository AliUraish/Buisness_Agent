import { describe, expect, it } from 'vitest'
import { sumBalanceTx } from './payments.ts'

describe('sumBalanceTx', () => {
  it('sums charges gross, fees, and count', () => {
    const t = sumBalanceTx([
      { type: 'charge', amount: 2900, fee: 114 },
      { type: 'payment', amount: 900, fee: 56 },
    ])
    expect(t.grossCents).toBe(3800)
    expect(t.feeCents).toBe(170)
    expect(t.count).toBe(2)
    expect(t.netCents).toBe(3630)
  })

  it('subtracts refunds (negative amounts) from net', () => {
    const t = sumBalanceTx([
      { type: 'charge', amount: 2900, fee: 114 },
      { type: 'refund', amount: -2900 },
    ])
    expect(t.grossCents).toBe(2900)
    expect(t.refundCents).toBe(2900)
    expect(t.netCents).toBe(-114) // refunded charge still cost the fee
  })

  it('ignores unrelated transaction types (payouts, adjustments)', () => {
    const t = sumBalanceTx([
      { type: 'payout', amount: -50000 },
      { type: 'adjustment', amount: 120 },
      { type: 'charge', amount: 500, fee: 30 },
    ])
    expect(t.grossCents).toBe(500)
    expect(t.count).toBe(1)
  })

  it('handles an empty day', () => {
    const t = sumBalanceTx([])
    expect(t).toEqual({ grossCents: 0, feeCents: 0, refundCents: 0, netCents: 0, count: 0 })
  })
})
