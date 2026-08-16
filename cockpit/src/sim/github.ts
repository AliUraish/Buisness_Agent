// Thin client for /api/github/* — the token stays on the backend.

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
  canPush?: boolean
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
    canPush: false,
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

export async function shipGithubFeature(input: {
  slug: string
  name: string
  summary: string
  brief: string
  file: string
}): Promise<{
  live: boolean
  merged: boolean
  number: number
  title: string
  branch: string
  file: string
  sha: string
  url: string | null
  error: string | null
}> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 90000)
  try {
    const res = await fetch('/api/github/ship', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: ctl.signal,
    })
    const json = await res.json()
    if (!res.ok) {
      return {
        live: false,
        merged: false,
        number: 0,
        title: '',
        branch: '',
        file: input.file,
        sha: '',
        url: null,
        error: typeof json?.error === 'string' ? json.error : `Backend ${res.status}`,
      }
    }
    return json
  } catch {
    return {
      live: false,
      merged: false,
      number: 0,
      title: '',
      branch: '',
      file: input.file,
      sha: '',
      url: null,
      error: 'Backend not reachable. Run npm run dev in /backend.',
    }
  } finally {
    clearTimeout(t)
  }
}

export async function mergeGithubPr(number: number): Promise<{ live: boolean; merged: boolean; sha: string; error: string | null }> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 45000)
  try {
    const res = await fetch('/api/github/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number }),
      signal: ctl.signal,
    })
    const json = await res.json()
    if (!res.ok) {
      return { live: false, merged: false, sha: '', error: typeof json?.error === 'string' ? json.error : `Backend ${res.status}` }
    }
    return json
  } catch {
    return { live: false, merged: false, sha: '', error: 'Backend not reachable. Run npm run dev in /backend.' }
  } finally {
    clearTimeout(t)
  }
}
