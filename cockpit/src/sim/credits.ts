// Mock compute credits the agents run on. When the pool runs low,
// Credit Buyer purchases a pack from treasury (not a real card).

export const CREDIT_BOOT = 18
export const CREDIT_PACK = 40
export const CREDIT_PACK_USD = 9
export const CREDIT_LOW = 8
export const CREDIT_MAX_BUYS = 8

export interface CreditBook {
  balance: number
  bought: number
  lastBuyAt: number
  lastPack: number
  lastCost: number
  lastBuyer: string | null
}

export function blankCredits(): CreditBook {
  return { balance: CREDIT_BOOT, bought: 0, lastBuyAt: 0, lastPack: 0, lastCost: 0, lastBuyer: null }
}

export function shouldBuyCredits(book: Pick<CreditBook, 'balance' | 'bought'>): boolean {
  return book.balance <= CREDIT_LOW && book.bought < CREDIT_MAX_BUYS
}
