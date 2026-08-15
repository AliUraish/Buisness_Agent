// Follower population for the Audience Map. Generated once, seeded, and
// laid out with d3-force so every load produces the same organic clusters.
import { forceSimulation, forceX, forceY, forceCollide } from 'd3-force'
import { mulberry32, pick } from '../sim/rng'

export interface Cluster {
  id: string
  name: string
  color: string
  count: number
  anchor: { x: number; y: number }
  keywords: string[]
}

export const CLUSTERS: Cluster[] = [
  { id: 'infra', name: 'AI Infra Engineers', color: '#7c6ff0', count: 637, anchor: { x: 840, y: 420 }, keywords: ['infra', 'engineer', 'gpu', 'dev'] },
  { id: 'builders', name: 'AI Startup Builders', color: '#2ab3a6', count: 147, anchor: { x: 340, y: 380 }, keywords: ['builder', 'founder', 'startup builder', 'indie'] },
  { id: 'investors', name: 'AI Investors', color: '#e8a33d', count: 83, anchor: { x: 560, y: 300 }, keywords: ['investor', 'vc', 'fund', 'angel'] },
  { id: 'operators', name: 'Startup Operators', color: '#e05c8a', count: 74, anchor: { x: 330, y: 210 }, keywords: ['operator', 'ops', 'growth', 'gtm'] },
  { id: 'crypto', name: 'Crypto Traders', color: '#3fa55c', count: 64, anchor: { x: 615, y: 150 }, keywords: ['crypto', 'trader', 'defi', 'token'] },
]

export interface Follower {
  id: number
  cluster: string
  x: number
  y: number
  r: number
  engagement: number // 0..1
  followers: number
  name: string
  handle: string
  initials: string
}

export interface Tie {
  a: number
  b: number
  cluster: string
}

const FIRST = ['Mira', 'Dev', 'Sana', 'Kai', 'Lena', 'Ravi', 'Noor', 'Theo', 'Ada', 'Jules', 'Omar', 'Ivy', 'Marc', 'Tara', 'Niko', 'Zoe', 'Arjun', 'Elif', 'Sam', 'Priya', 'Leo', 'Anya', 'Chen', 'Rosa', 'Ken', 'Dana', 'Yuki', 'Igor', 'Maya', 'Cole']
const LAST = ['Okafor', 'Lindqvist', 'Tanaka', 'Alvarez', 'Novak', 'Iyer', 'Haddad', 'Kim', 'Moreau', 'Bishop', 'Sato', 'Kovacs', 'Diallo', 'Petrov', 'Nakamura', 'Silva', 'Weiss', 'Chandra', 'Ortiz', 'Larsen']
const HANDLE_BITS: Record<string, string[]> = {
  infra: ['builds', 'gpu', 'infra', 'systems', 'k8s', 'rust', 'ml'],
  builders: ['ships', 'builds', 'founder', 'zero2one', 'launch', 'mvp'],
  investors: ['capital', 'invests', 'fund', 'angel', 'thesis'],
  operators: ['ops', 'growth', 'scale', 'gtm', 'revops'],
  crypto: ['degen', 'onchain', 'defi', 'alpha', 'charts'],
}

function generate(): { followers: Follower[]; ties: Tie[] } {
  const rand = mulberry32(20260814)
  const followers: Follower[] = []
  let id = 0

  for (const c of CLUSTERS) {
    // 2–3 sub-clumps per cluster so blobs come out organic, not circular
    const clumps = 2 + Math.floor(rand() * 2)
    const subs = Array.from({ length: clumps }, () => ({
      x: c.anchor.x + (rand() - 0.5) * Math.sqrt(c.count) * 14,
      y: c.anchor.y + (rand() - 0.5) * Math.sqrt(c.count) * 9,
    }))
    for (let i = 0; i < c.count; i++) {
      const sub = subs[Math.floor(rand() * subs.length)]
      const engagement = Math.pow(rand(), 2.2)
      const first = pick(rand, FIRST)
      const last = pick(rand, LAST)
      const bit = pick(rand, HANDLE_BITS[c.id])
      followers.push({
        id: id++,
        cluster: c.id,
        x: sub.x + (rand() - 0.5) * Math.sqrt(c.count) * 7,
        y: sub.y + (rand() - 0.5) * Math.sqrt(c.count) * 5,
        r: 3.8 + engagement * 8.5,
        engagement,
        followers: Math.round(120 + Math.pow(rand(), 3) * 84000),
        name: `${first} ${last}`,
        handle: `@${first.toLowerCase()}_${bit}`,
        initials: first[0] + last[0],
      })
    }
  }

  // settle with a force layout — attraction to seed position + collision
  const sim = forceSimulation(followers as any)
    .force('x', forceX((d: any) => d.x).strength(0.055))
    .force('y', forceY((d: any) => d.y).strength(0.075))
    .force('collide', forceCollide((d: any) => d.r + 1.7).iterations(2))
    .stop()
  for (let i = 0; i < 220; i++) sim.tick()

  // faint intra-cluster ties: each node → nearest same-cluster neighbor
  const ties: Tie[] = []
  const seen = new Set<string>()
  for (const c of CLUSTERS) {
    const members = followers.filter((f) => f.cluster === c.id)
    for (const f of members) {
      let best: Follower | null = null
      let bestD = Infinity
      for (const g of members) {
        if (g.id === f.id) continue
        const d = (g.x - f.x) ** 2 + (g.y - f.y) ** 2
        if (d < bestD) {
          bestD = d
          best = g
        }
      }
      if (best && bestD < 48 * 48) {
        const key = f.id < best.id ? `${f.id}-${best.id}` : `${best.id}-${f.id}`
        if (!seen.has(key)) {
          seen.add(key)
          ties.push({ a: f.id, b: best.id, cluster: c.id })
        }
      }
    }
  }

  return { followers, ties }
}

// cache across HMR so the layout never recomputes mid-demo
const g = globalThis as { __audience?: { followers: Follower[]; ties: Tie[] } }
export const AUDIENCE = g.__audience ?? (g.__audience = generate())

export function clusterCentroid(clusterId: string, followers = AUDIENCE.followers): { x: number; y: number } {
  const members = followers.filter((f) => f.cluster === clusterId)
  if (members.length === 0) return CLUSTERS.find((c) => c.id === clusterId)?.anchor ?? { x: 500, y: 300 }
  let x = 0
  let y = 0
  for (const m of members) {
    x += m.x
    y += m.y
  }
  return { x: x / members.length, y: y / members.length }
}

export function layoutPeople(
  people: Array<{
    cluster: string
    name: string
    handle: string
    initials: string
    engagement: number
    followers: number
  }>,
  seed = 20260815,
): { followers: Follower[]; ties: Tie[] } {
  const rand = mulberry32(seed)
  const followers: Follower[] = people.map((p, i) => {
    const c = CLUSTERS.find((x) => x.id === p.cluster) ?? CLUSTERS[0]
    return {
      id: i,
      cluster: p.cluster,
      x: c.anchor.x + (rand() - 0.5) * 90,
      y: c.anchor.y + (rand() - 0.5) * 60,
      r: 3.8 + p.engagement * 8.5,
      engagement: p.engagement,
      followers: p.followers,
      name: p.name,
      handle: p.handle,
      initials: p.initials,
    }
  })
  const sim = forceSimulation(followers as any)
    .force('x', forceX((d: any) => d.x).strength(0.055))
    .force('y', forceY((d: any) => d.y).strength(0.075))
    .force('collide', forceCollide((d: any) => d.r + 1.7).iterations(2))
    .stop()
  for (let i = 0; i < 180; i++) sim.tick()

  const ties: Tie[] = []
  const seen = new Set<string>()
  for (const c of CLUSTERS) {
    const members = followers.filter((f) => f.cluster === c.id)
    for (const f of members) {
      let best: Follower | null = null
      let bestD = Infinity
      for (const g of members) {
        if (g.id === f.id) continue
        const d = (g.x - f.x) ** 2 + (g.y - f.y) ** 2
        if (d < bestD) {
          bestD = d
          best = g
        }
      }
      if (best && bestD < 48 * 48) {
        const key = f.id < best.id ? `${f.id}-${best.id}` : `${best.id}-${f.id}`
        if (!seen.has(key)) {
          seen.add(key)
          ties.push({ a: f.id, b: best.id, cluster: c.id })
        }
      }
    }
  }
  return { followers, ties }
}

export function clusterCounts(followers: Follower[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(CLUSTERS.map((c) => [c.id, 0]))
  for (const f of followers) out[f.cluster] = (out[f.cluster] ?? 0) + 1
  return out
}
