import { describe, expect, it } from 'vitest'
import { onboardText, toE164 } from './linq.ts'

describe('toE164', () => {
  it('normalizes formatted US numbers', () => {
    expect(toE164('+1 (212) 555-0123')).toBe('+12125550123')
    expect(toE164('212-555-0123')).toBe('+12125550123')
    expect(toE164('+12125550123')).toBe('+12125550123')
  })

  it('rejects non-phone values (emails, usernames)', () => {
    expect(toE164('aliuraishmirani@gmail.com')).toBe(null)
    expect(toE164('aliuraish')).toBe(null)
    expect(toE164('')).toBe(null)
  })
})

describe('onboardText', () => {
  it('puts the Stripe subscribe link in the Linq message', () => {
    const t = onboardText('https://buy.stripe.com/test_abc')
    expect(t).toContain('https://buy.stripe.com/test_abc')
    expect(t).toMatch(/subscribe/i)
    expect(t).toContain('agentbasis.co')
  })
})

describe('toE164', () => {
  it('normalizes formatted US numbers', () => {
    expect(toE164('+1 (212) 555-0123')).toBe('+12125550123')
    expect(toE164('212-555-0123')).toBe('+12125550123')
    expect(toE164('+12125550123')).toBe('+12125550123')
  })

  it('rejects non-phone values (emails, usernames)', () => {
    expect(toE164('aliuraishmirani@gmail.com')).toBe(null)
    expect(toE164('aliuraish')).toBe(null)
    expect(toE164('')).toBe(null)
  })
})
