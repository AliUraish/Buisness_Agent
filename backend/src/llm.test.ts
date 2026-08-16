import { describe, expect, it } from 'vitest'
import { llmStatus, rechargeCredits } from './llm.ts'

describe('rechargeCredits', () => {
  it('adds a pack to the session call cap', () => {
    const before = llmStatus()
    const r = rechargeCredits(40)
    expect(r.ok).toBe(true)
    expect(r.added).toBe(40)
    expect(r.callsMax).toBe(before.callsMax + 40)
    expect(r.remaining).toBe(before.remaining + 40)
  })
})
