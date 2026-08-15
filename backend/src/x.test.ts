import { describe, expect, it } from 'vitest'
import { clusterFromBio } from './x.ts'

describe('clusterFromBio', () => {
  it('puts GPU/infra bios in infra', () => {
    expect(clusterFromBio('ML infra engineer. GPUs and k8s.')).toBe('infra')
  })
  it('puts VC bios in investors', () => {
    expect(clusterFromBio('Angel investor. Seed fund partner.')).toBe('investors')
  })
  it('defaults unmatched / Terac-adjacent people to builders', () => {
    expect(clusterFromBio('Building at the Terac hackathon')).toBe('builders')
  })
})
