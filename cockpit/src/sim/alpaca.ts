// Alpaca client. Market data (crypto) needs no auth; paper orders need the
// API keys, which the Vite dev proxy injects server-side from ../.env —
// they never reach the browser bundle. All calls go through the proxy paths
// so CORS is a non-issue.

declare const __ALPACA_ORDERS__: boolean

export const ORDERS_ENABLED = typeof __ALPACA_ORDERS__ !== 'undefined' && __ALPACA_ORDERS__

export const ALPACA_SYMBOL: Record<string, string> = {
  btc: 'BTC/USD',
  eth: 'ETH/USD',
  sol: 'SOL/USD',
  doge: 'DOGE/USD',
  avax: 'AVAX/USD',
}

const DATA = '/alpaca/data/v1beta3/crypto/us'
const PAPER = '/alpaca/paper/v2'

function symbolsParam(ids: string[]): string {
  return encodeURIComponent(ids.map((id) => ALPACA_SYMBOL[id]).join(','))
}

async function get(url: string, timeoutMs = 7000): Promise<any> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

// latest trade price per asset id
export async function fetchLatestPrices(ids: string[]): Promise<Record<string, number>> {
  const json = await get(`${DATA}/latest/trades?symbols=${symbolsParam(ids)}`)
  const out: Record<string, number> = {}
  for (const id of ids) {
    const t = json.trades?.[ALPACA_SYMBOL[id]]
    if (t && Number.isFinite(t.p) && t.p > 0) out[id] = t.p
  }
  if (Object.keys(out).length === 0) throw new Error('no trades in response')
  return out
}

// trailing close prices per asset id, oldest first (5-minute bars)
export async function fetchBars(ids: string[], limit = 110): Promise<Record<string, number[]>> {
  const start = new Date(Date.now() - limit * 5 * 60_000).toISOString()
  const json = await get(`${DATA}/bars?symbols=${symbolsParam(ids)}&timeframe=5Min&start=${encodeURIComponent(start)}&limit=${limit}`)
  const out: Record<string, number[]> = {}
  for (const id of ids) {
    const bars = json.bars?.[ALPACA_SYMBOL[id]]
    if (Array.isArray(bars) && bars.length > 2) {
      out[id] = bars.map((b: { c: number }) => b.c).filter((c: number) => Number.isFinite(c) && c > 0)
    }
  }
  return out
}

// market BUY by notional USD against the paper account
export async function submitPaperOrder(assetId: string, notional: number): Promise<{ id: string; filledPrice: number | null }> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 8000)
  try {
    const res = await fetch(`${PAPER}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctl.signal,
      body: JSON.stringify({
        symbol: ALPACA_SYMBOL[assetId],
        notional: String(notional),
        side: 'buy',
        type: 'market',
        time_in_force: 'gtc',
      }),
    })
    if (!res.ok) throw new Error(`order HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`)
    const json = await res.json()
    const filled = Number(json.filled_avg_price)
    return { id: String(json.id ?? '').slice(0, 8), filledPrice: Number.isFinite(filled) && filled > 0 ? filled : null }
  } finally {
    clearTimeout(t)
  }
}
