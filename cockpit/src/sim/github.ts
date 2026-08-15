// Thin client for GET /api/github/* — the token stays on the backend.

export interface GithubCommit {
  sha: string
  message: string
  author: string
  at: number
  url: string
  pr: number | null
}

export interface GithubPr {
  number: number
  title: string
  state: 'open' | 'closed'
  merged: boolean
  author: string
  at: number
  url: string
}

export interface GithubFeature {
  id: string
  name: string
  summary: string
  chips: string[]
  sha: string
  pr: number | null
  at: number
  commitCount: number
}

export interface GithubRepoInfo {
  fullName: string
  pushedAt: number
  private: boolean
}

export interface GithubScan {
  live: boolean
  repo: string | null
  login: string | null
  lastScanAt: number
  error: string | null
  commits: GithubCommit[]
  prs: GithubPr[]
  features: GithubFeature[]
  commitsPerDay: number[]
  openPRs: number
  repos: GithubRepoInfo[]
}

export interface MarketingNeed {
  id: string
  feature: string
  summary: string
  chips: string[]
  sha: string
  pr: number | null
  status: 'queued' | 'posting' | 'posted'
  at: number
  postedAt?: number
}

export function blankGithubScan(): GithubScan {
  return {
    live: false,
    repo: null,
    login: null,
    lastScanAt: 0,
    error: null,
    commits: [],
    prs: [],
    features: [],
    commitsPerDay: [],
    openPRs: 0,
    repos: [],
  }
}

export async function fetchGithubScan(repo?: string | null): Promise<GithubScan> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 25000)
  try {
    const q = repo ? `?repo=${encodeURIComponent(repo)}` : ''
    const res = await fetch('/api/github/scan' + q, { signal: ctl.signal })
    const json = await res.json()
    if (!res.ok) {
      return {
        ...blankGithubScan(),
        lastScanAt: Date.now(),
        error: typeof json?.error === 'string' ? json.error : `Backend ${res.status}`,
      }
    }
    return json as GithubScan
  } catch {
    return {
      ...blankGithubScan(),
      lastScanAt: Date.now(),
      error: 'Backend not reachable. Run npm run dev in /backend.',
    }
  } finally {
    clearTimeout(t)
  }
}
