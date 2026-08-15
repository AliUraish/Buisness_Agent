// X (Twitter) audience for @tryterac. Official API only — no HTML scrape.
// Follower lists need follows.read and often a paid tier; if that 403s we
// fall back to recent mention authors so the swarm still has real people.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { X_BEARER_TOKEN } from './env.ts'

const BASE = 'https://api.x.com/2'
const HANDLE = 'tryterac'
const USER_FIELDS = 'description,public_metrics,username,name,profile_image_url'

export function isXLive(): boolean {
  if (!X_BEARER_TOKEN) return false
  // OpenAI keys (sk- / sk-proj-) are not X bearer tokens.
  if (/^sk-/i.test(X_BEARER_TOKEN)) return false
  return true
}

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

const CLUSTER_KEYS: { id: string; words: string[] }[] = [
  { id: 'infra', words: ['infra', 'engineer', 'gpu', 'dev', 'mlops', 'pytorch', 'k8s', 'kubernetes', 'systems', 'backend'] },
  { id: 'builders', words: ['builder', 'founder', 'startup', 'indie', 'hackathon', 'terac', 'ship', 'maker', 'yc'] },
  { id: 'investors', words: ['investor', 'vc', 'fund', 'angel', 'capital', 'partner'] },
  { id: 'operators', words: ['operator', 'ops', 'growth', 'gtm', 'revops', 'marketing'] },
  { id: 'crypto', words: ['crypto', 'trader', 'defi', 'token', 'onchain', 'web3', 'nft'] },
]

export function clusterFromBio(text: string): string {
  const t = text.toLowerCase()
  let best = 'builders'
  let score = 0
  for (const c of CLUSTER_KEYS) {
    const n = c.words.filter((w) => t.includes(w)).length
    if (n > score) {
      score = n
      best = c.id
    }
  }
  return best
}

function initialsOf(name: string, handle: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  if (parts[0]?.length >= 2) return parts[0].slice(0, 2).toUpperCase()
  return (handle.replace(/^@/, '').slice(0, 2) || '??').toUpperCase()
}

function asPerson(u: any): XPerson | null {
  const handle = String(u?.username ?? '').replace(/^@/, '')
  if (!handle) return null
  const name = String(u?.name ?? handle)
  const bio = String(u?.description ?? '')
  const followers = Number(u?.public_metrics?.followers_count ?? 0)
  const engagement = Math.min(1, Math.log10(Math.max(followers, 1)) / 6)
  return {
    name,
    handle: `@${handle}`,
    initials: initialsOf(name, handle),
    bio,
    followers,
    engagement,
    cluster: clusterFromBio(`${bio} ${name} ${handle}`),
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function xget(path: string, timeoutMs = 12000): Promise<{ ok: boolean; status: number; json: any }> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(BASE + path, {
      headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` },
      signal: ctl.signal,
    })
    const text = await res.text()
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { raw: text }
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') ?? 2)
      await sleep(Math.min(Math.max(wait, 1), 8) * 1000)
    }
    return { ok: res.ok, status: res.status, json }
  } finally {
    clearTimeout(t)
  }
}

function errMsg(json: any, fallback: string): string {
  const raw = String(json?.detail ?? json?.title ?? json?.errors?.[0]?.message ?? fallback)
  if (/credit/i.test(raw)) {
    return 'X API credits are depleted on this app. Add credits at developer.x.com → your Project → Billing, then click @tryterac again.'
  }
  return raw
}

async function lookupUser(handle: string): Promise<{ id: string; name: string; followers: number } | { error: string }> {
  const r = await xget(
    `/users/by/username/${encodeURIComponent(handle)}?user.fields=public_metrics,name,username`,
  )
  if (!r.ok || !r.json?.data?.id) {
    return { error: errMsg(r.json, `X ${r.status}: could not look up @${handle}`) }
  }
  const d = r.json.data
  return {
    id: String(d.id),
    name: String(d.name ?? handle),
    followers: Number(d.public_metrics?.followers_count ?? 0),
  }
}

async function fetchFollowers(userId: string): Promise<XPerson[] | { error: string; status: number }> {
  const people: XPerson[] = []
  let token: string | undefined
    for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({
        max_results: '100',
      'user.fields': USER_FIELDS,
    })
    if (token) q.set('pagination_token', token)
    const r = await xget(`/users/${encodeURIComponent(userId)}/followers?${q}`)
    if (!r.ok) return { error: errMsg(r.json, `X ${r.status}`), status: r.status }
    const rows: any[] = r.json?.data ?? []
    for (const u of rows) {
      const p = asPerson(u)
      if (p) people.push(p)
    }
    token = r.json?.meta?.next_token
    if (!token || people.length >= 400) break
  }
  return people.slice(0, 400)
}

async function fetchMentionAuthors(handle: string): Promise<XPerson[]> {
  const q = new URLSearchParams({
    query: `@${handle} -is:retweet`,
    max_results: '100',
    expansions: 'author_id',
    'user.fields': USER_FIELDS,
    'tweet.fields': 'author_id',
  })
  const r = await xget(`/tweets/search/recent?${q}`)
  if (!r.ok) return []
  const users: any[] = r.json?.includes?.users ?? []
  const seen = new Set<string>()
  const people: XPerson[] = []
  for (const u of users) {
    const p = asPerson(u)
    if (!p || seen.has(p.handle)) continue
    seen.add(p.handle)
    people.push(p)
  }
  return people
}

let inflight: Promise<XAudience> | null = null
const SNAPSHOT = resolve(fileURLToPath(new URL('../data/tryterac-audience.json', import.meta.url)))

function emptyAudience(reason: string): XAudience {
  return {
    live: false,
    handle: `@${HANDLE}`,
    name: 'Terac',
    followerCount: null,
    mode: 'off',
    people: [],
    reason,
    savedAt: null,
  }
}

export function readSnapshot(): XAudience | null {
  if (!existsSync(SNAPSHOT)) return null
  try {
    const json = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as XAudience
    if (!Array.isArray(json?.people) || json.people.length === 0) return null
    return json
  } catch {
    return null
  }
}

function writeSnapshot(payload: XAudience) {
  mkdirSync(resolve(SNAPSHOT, '..'), { recursive: true })
  writeFileSync(SNAPSHOT, JSON.stringify(payload, null, 2))
}

function withSavedNote(payload: XAudience): XAudience {
  const n = payload.people.length
  const when = payload.savedAt ? ` · ${payload.savedAt.slice(0, 10)}` : ''
  return {
    ...payload,
    live: true,
    reason: `Saved snapshot · ${n} people${when}. X is not called again.`,
  }
}

async function pullFromX(): Promise<XAudience> {
  if (!isXLive()) {
    return emptyAudience(
      'X_BEARER_TOKEN is missing or is not an X token. Paste the Bearer Token from developer.x.com (not an OpenAI sk- key), then restart the backend.',
    )
  }

  const user = await lookupUser(HANDLE)
  if ('error' in user) return emptyAudience(user.error)

  const followers = await fetchFollowers(user.id)
  if (Array.isArray(followers) && followers.length > 0) {
    const payload: XAudience = {
      live: true,
      handle: `@${HANDLE}`,
      name: user.name,
      followerCount: user.followers,
      mode: 'followers',
      people: followers,
      reason: null,
      savedAt: new Date().toISOString(),
    }
    writeSnapshot(payload)
    return withSavedNote(payload)
  }

  const mentions = await fetchMentionAuthors(HANDLE)
  const blocked = !Array.isArray(followers)
  const payload: XAudience = {
    live: mentions.length > 0,
    handle: `@${HANDLE}`,
    name: user.name,
    followerCount: user.followers,
    mode: mentions.length > 0 ? 'mentions' : 'off',
    people: mentions,
    reason: null,
    savedAt: mentions.length > 0 ? new Date().toISOString() : null,
  }
  if (mentions.length > 0) {
    payload.reason = `Follower list isn't on this X API tier${blocked ? ` (${followers.error})` : ''}. Saved mention authors instead.`
    writeSnapshot(payload)
    return withSavedNote(payload)
  }
  return emptyAudience(
    blocked ? followers.error : `No recent mentions of @${HANDLE} to plot.`,
  )
}

export async function loadTryteracAudience(opts?: { refresh?: boolean }): Promise<XAudience> {
  if (!opts?.refresh) {
    const saved = readSnapshot()
    if (saved) {
      console.log(`[x] saved snapshot · ${saved.people.length} people · not calling X`)
      return withSavedNote(saved)
    }
    return emptyAudience(
      'No saved @tryterac snapshot on disk. This server will not call X. To fetch once, GET /api/x/audience?refresh=1',
    )
  }
  if (inflight) return inflight
  console.log('[x] refresh=1 · calling X once, then saving')
  inflight = pullFromX().finally(() => {
    inflight = null
  })
  return inflight
}

export function snapshotStatus() {
  const saved = readSnapshot()
  return { saved: Boolean(saved), count: saved?.people.length ?? 0, savedAt: saved?.savedAt ?? null }
}
