// Thin client for GET /api/x/audience — keys stay on the backend.
import { apiUrl } from './api.ts'

export interface XPerson {
  name: string
  handle: string
  initials: string
  bio: string
  followers: number
  engagement: number
  cluster: string
}

export interface XAudience {
  live: boolean
  handle: string
  name: string
  followerCount: number | null
  mode: 'followers' | 'mentions' | 'off'
  people: XPerson[]
  reason: string | null
  savedAt: string | null
}

export async function fetchTryteracAudience(): Promise<XAudience> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 25000)
  try {
    const res = await fetch(apiUrl('/api/x/audience'), { signal: ctl.signal })
    const json = await res.json()
    if (!res.ok) {
      return {
        live: false,
        handle: '@tryterac',
        name: 'Terac',
        followerCount: null,
        mode: 'off',
        people: [],
        reason: typeof json?.error === 'string' ? json.error : `Backend ${res.status}`,
        savedAt: null,
      }
    }
    return json as XAudience
  } catch {
    return {
      live: false,
      handle: '@tryterac',
      name: 'Terac',
      followerCount: null,
      mode: 'off',
      people: [],
      reason: 'Backend not reachable. Run npm run dev in /backend.',
      savedAt: null,
    }
  } finally {
    clearTimeout(t)
  }
}
