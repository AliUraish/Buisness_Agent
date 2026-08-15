// Seeded 30-day revenue history ending at the engine's starting MRR, with
// past campaign markers and the bumps that followed them — so the
// cause→effect underlines have something real to point at.
import { mulberry32 } from '../sim/rng'

export interface CampaignMark {
  day: number // days before now (positive = past), 0 = today
  label: string
  bump: number // $ added over the following ~2 days
  bumpDays: number
}

export const PAST_CAMPAIGNS: CampaignMark[] = [
  { day: 26, label: 'campaign #1 — usage-based billing', bump: 74, bumpDays: 2 },
  { day: 18, label: 'campaign #2 — API keys', bump: 96, bumpDays: 2 },
  { day: 8, label: 'campaign #3 — webhooks v2', bump: 118, bumpDays: 2 },
]

// history[0] = 30 days ago … history[30] = now (caller overwrites with live MRR)
export function buildHistory(endValue: number): number[] {
  const rand = mulberry32(4041)
  const days = 30
  const deltas: number[] = []
  for (let d = 0; d < days; d++) {
    let delta = 2 + rand() * 8 // slow ambient drift
    if (rand() < 0.12) delta -= 14 // occasional churn dip
    for (const c of PAST_CAMPAIGNS) {
      const daysAfter = c.day - (days - 1 - d) // how far past the campaign this day is
      if (daysAfter > 0 && daysAfter <= c.bumpDays) delta += c.bump / c.bumpDays
    }
    deltas.push(delta)
  }
  const total = deltas.reduce((s, x) => s + x, 0)
  const start = endValue - total
  const out = [start]
  for (const d of deltas) out.push(out[out.length - 1] + d)
  return out
}
