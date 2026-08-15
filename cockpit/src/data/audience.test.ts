import { describe, expect, it } from 'vitest'
import { AUDIENCE, CLUSTERS, clusterCentroid, layoutPeople } from './audience'

describe('audience generation', () => {
  it('generates exactly the advertised follower counts per cluster', () => {
    for (const c of CLUSTERS) {
      const members = AUDIENCE.followers.filter((f) => f.cluster === c.id)
      expect(members.length).toBe(c.count)
    }
    const total = CLUSTERS.reduce((s, c) => s + c.count, 0)
    expect(AUDIENCE.followers.length).toBe(total)
    expect(total).toBe(1005)
  })

  it('assigns sequential ids matching array index (hover/highlight lookups rely on this)', () => {
    AUDIENCE.followers.forEach((f, i) => expect(f.id).toBe(i))
  })

  it('keeps engagement in [0, 1] and radius positive', () => {
    for (const f of AUDIENCE.followers) {
      expect(f.engagement).toBeGreaterThanOrEqual(0)
      expect(f.engagement).toBeLessThanOrEqual(1)
      expect(f.r).toBeGreaterThan(0)
      expect(Number.isFinite(f.x)).toBe(true)
      expect(Number.isFinite(f.y)).toBe(true)
    }
  })

  it('only ties followers within the same cluster', () => {
    for (const t of AUDIENCE.ties) {
      expect(AUDIENCE.followers[t.a].cluster).toBe(t.cluster)
      expect(AUDIENCE.followers[t.b].cluster).toBe(t.cluster)
    }
  })

  it('computes finite centroids for every cluster', () => {
    for (const c of CLUSTERS) {
      const p = clusterCentroid(c.id)
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
  })

  it('lays out live people onto the same cluster anchors', () => {
    const { followers } = layoutPeople([
      { cluster: 'crypto', name: 'Ada', handle: '@ada', initials: 'AD', engagement: 0.4, followers: 12 },
      { cluster: 'infra', name: 'Kai', handle: '@kai', initials: 'KA', engagement: 0.2, followers: 8 },
    ])
    expect(followers.length).toBe(2)
    expect(followers[0].id).toBe(0)
    expect(Number.isFinite(followers[0].x)).toBe(true)
  })
})
