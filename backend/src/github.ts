// Owns the GitHub REST scan and the agent ship writes. The token stays here —
// Cockpit never sees it. Pinned to AgentBasis/agentbasis-python-sdk.

import { GITHUB_TOKEN } from './env.ts'

const BASE = 'https://api.github.com'
export const FOCUS_REPO = 'AgentBasis/agentbasis-python-sdk'
const SKIP_TYPES = new Set(['chore', 'docs', 'test', 'ci', 'style', 'build', 'revert'])
const SKIP_SCOPES = new Set(['tests', 'test', 'docs', 'ci', 'chore'])
const GENERIC_SCOPES = new Set(['app', 'core', 'main', 'misc', 'src', 'repo', 'api', 'env', 'hooks', 'example', 'frontend', 'backend', 'demo'])

export function isGithubLive(): boolean {
  return Boolean(GITHUB_TOKEN)
}

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

export function parsePrNumber(message: string): number | null {
  const m = message.match(/(?:pull request #|#)(\d+)/i)
  return m ? Number(m[1]) : null
}

export function parseConventional(subject: string): { type: string; scope: string | null; rest: string } | null {
  const m = subject.trim().match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/)
  if (!m) return null
  return { type: m[1].toLowerCase(), scope: m[2]?.trim() || null, rest: m[3].trim() }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'feature'
}

function humanize(s: string): string {
  const t = s.replace(/[-_]/g, ' ').trim()
  if (!t) return s
  if (/^[A-Z][A-Za-z0-9]+(?:[A-Z][A-Za-z0-9]+)*$/.test(s)) return s
  return t.replace(/\s+/g, ' ')
}

function titleCase(s: string): string {
  const t = s.trim()
  if (!t) return t
  return t[0].toUpperCase() + t.slice(1)
}

function featureName(conv: { type: string; scope: string | null; rest: string }): string {
  if (conv.scope && !GENERIC_SCOPES.has(conv.scope.toLowerCase()) && !SKIP_SCOPES.has(conv.scope.toLowerCase())) {
    return humanize(conv.scope)
  }
  const rest = conv.rest.replace(/\s*\(#\d+\)\s*$/, '').replace(/\.$/, '')
  return titleCase(rest.slice(0, 56))
}

function freeformName(subject: string): string | null {
  if (/^merge\b/i.test(subject)) return null
  if (/^(wip|bump|fixes?|fixup|typo|nit|all tests passed)\b/i.test(subject)) return null
  if (/\b(unit tests?|add(?:ed)? (?:comprehensive )?tests|mock classes)\b/i.test(subject)) return null
  const m = subject.match(/^(?:Add(?:ed)?|Enhance|Implement|Introduce)\s+(.+)$/i)
  if (!m) return null
  let rest = m[1].replace(/\.$/, '').trim()
  rest = rest.split(/,\s+(?:including|with)\b/i)[0]
  if (rest.length > 56) {
    const cut = rest.slice(0, 56)
    const sp = cut.lastIndexOf(' ')
    rest = sp > 24 ? cut.slice(0, sp) : cut
  }
  return titleCase(rest)
}

export function extractFeatures(
  commits: Pick<GithubCommit, 'sha' | 'message' | 'at' | 'pr'>[],
  prs: Pick<GithubPr, 'number' | 'title' | 'merged' | 'at'>[],
): GithubFeature[] {
  const groups = new Map<string, GithubFeature>()

  const take = (name: string, summary: string, sha: string, pr: number | null, at: number) => {
    const id = 'g-' + slug(name)
    const prev = groups.get(id)
    if (prev) {
      prev.commitCount++
      if (at > prev.at) {
        prev.at = at
        prev.sha = sha
        prev.summary = summary
      }
      if (pr != null) prev.pr = pr
      return
    }
    groups.set(id, {
      id,
      name,
      summary,
      chips: [],
      sha,
      pr,
      at,
      commitCount: 1,
    })
  }

  const bumpPr = (pr: number, sha: string, at: number) => {
    for (const f of groups.values()) {
      if (f.pr === pr) {
        f.commitCount++
        if (sha && at >= f.at) f.sha = sha
        return true
      }
    }
    return false
  }

  for (const p of prs) {
    if (!p.merged) continue
    const subject = p.title.split('\n')[0] ?? ''
    if (/^wip\b|^bump\b|^merge\b/i.test(subject)) continue
    const conv = parseConventional(subject)
    if (conv) {
      if (SKIP_TYPES.has(conv.type)) continue
      if (conv.scope && SKIP_SCOPES.has(conv.scope.toLowerCase())) continue
      if (conv.type !== 'feat' && conv.type !== 'feature' && conv.type !== 'add') continue
      take(featureName(conv), conv.rest, '', p.number, p.at)
    } else {
      take(titleCase(subject.slice(0, 56)), subject, '', p.number, p.at)
    }
  }

  for (const c of commits) {
    const subject = c.message.split('\n')[0] ?? ''
    const pr = c.pr ?? parsePrNumber(subject)
    if (/^merge\b/i.test(subject)) {
      if (pr != null) bumpPr(pr, c.sha, c.at)
      continue
    }
    const conv = parseConventional(subject)
    if (conv) {
      if (SKIP_TYPES.has(conv.type)) continue
      if (conv.scope && SKIP_SCOPES.has(conv.scope.toLowerCase())) continue
      if (conv.type !== 'feat' && conv.type !== 'feature') continue
      const name = featureName(conv)
      const summary = conv.rest.replace(/\s*\(#\d+\)\s*$/, '')
      take(name, summary, c.sha, pr, c.at)
      continue
    }
    const free = freeformName(subject)
    if (free) take(free, subject, c.sha, pr, c.at)
  }

  const out = [...groups.values()].sort((a, b) => b.at - a.at)
  for (const f of out) {
    const chips: string[] = []
    if (f.pr != null) chips.push(`PR #${f.pr}`)
    if (f.sha) chips.push(f.sha.slice(0, 7))
    if (f.commitCount > 1) chips.push(`${f.commitCount} commits`)
    f.chips = chips
  }
  return out.slice(0, 24)
}

export function commitsPerDay(commits: Pick<GithubCommit, 'at'>[], days = 14): number[] {
  const buckets = Array.from({ length: days }, () => 0)
  const now = Date.now()
  const day = 86_400_000
  for (const c of commits) {
    const i = days - 1 - Math.floor((now - c.at) / day)
    if (i >= 0 && i < days) buckets[i]++
  }
  return buckets
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function ghreq(
  path: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<{ ok: boolean; status: number; json: any }> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), init?.timeoutMs ?? 20000)
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'business-agent-backend',
    }
    if (init?.body != null) headers['Content-Type'] = 'application/json'
    const res = await fetch(BASE + path, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body != null ? JSON.stringify(init.body) : undefined,
      signal: ctl.signal,
    })
    const text = await res.text()
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { raw: text.slice(0, 180) }
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

function ghget(path: string, timeoutMs = 15000) {
  return ghreq(path, { timeoutMs })
}

function errMsg(json: any, fallback: string): string {
  return json?.message ?? json?.error ?? fallback
}

function offScan(error: string, repos: GithubRepoInfo[] = [], login: string | null = null): GithubScan {
  return {
    live: false,
    repo: null,
    login,
    lastScanAt: Date.now(),
    error,
    commits: [],
    prs: [],
    features: [],
    commitsPerDay: Array.from({ length: 14 }, () => 0),
    openPRs: 0,
    repos,
  }
}

async function fetchPages<T>(path: string, maxPages: number, perPage: number): Promise<{ rows: T[]; error: string | null; status: number }> {
  const rows: T[] = []
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes('?') ? '&' : '?'
    const r = await ghget(`${path}${sep}per_page=${perPage}&page=${page}`)
    if (!r.ok) return { rows, error: errMsg(r.json, `GitHub ${r.status}`), status: r.status }
    const batch: T[] = Array.isArray(r.json) ? r.json : []
    rows.push(...batch)
    if (batch.length < perPage) break
  }
  return { rows, error: null, status: 200 }
}

export async function listRepos(): Promise<{ login: string | null; repos: GithubRepoInfo[]; error: string | null }> {
  if (!isGithubLive()) {
    return { login: null, repos: [], error: 'Set GITHUB_TOKEN in the workspace .env, then restart the backend.' }
  }
  const user = await ghget('/user')
  const login = user.ok ? String(user.json?.login ?? '') || null : null
  if (!user.ok) return { login: null, repos: [], error: errMsg(user.json, `GitHub ${user.status}`) }
  return {
    login,
    repos: [{ fullName: FOCUS_REPO, pushedAt: Date.now(), private: false }],
    error: null,
  }
}

export function pickDefaultRepo(_login: string | null, _repos: GithubRepoInfo[], _requested?: string | null): string | null {
  return FOCUS_REPO
}

function asCommit(c: any): GithubCommit | null {
  const sha = String(c?.sha ?? '')
  const message = String(c?.commit?.message ?? '')
  if (!sha || !message) return null
  return {
    sha,
    message,
    author: String(c?.commit?.author?.name ?? c?.author?.login ?? 'unknown'),
    at: Date.parse(c?.commit?.author?.date ?? '') || Date.now(),
    url: String(c?.html_url ?? ''),
    pr: parsePrNumber(message),
  }
}

function asPr(p: any): GithubPr | null {
  const number = Number(p?.number)
  const title = String(p?.title ?? '')
  if (!number || !title) return null
  return {
    number,
    title,
    state: p?.state === 'open' ? 'open' : 'closed',
    merged: Boolean(p?.merged_at),
    author: String(p?.user?.login ?? 'unknown'),
    at: Date.parse(p?.merged_at ?? p?.updated_at ?? p?.created_at ?? '') || Date.now(),
    url: String(p?.html_url ?? ''),
  }
}

let cache: { key: string; at: number; payload: GithubScan } | null = null
const TTL = 20_000

export async function scanRepo(_requested?: string | null): Promise<GithubScan> {
  const repo = FOCUS_REPO
  if (cache && cache.key === repo && Date.now() - cache.at < TTL) return cache.payload

  if (!isGithubLive()) {
    return offScan('Set GITHUB_TOKEN in the workspace .env, then restart the backend.')
  }

  const user = await ghget('/user')
  const login = user.ok ? String(user.json?.login ?? '') || null : null
  const pinned: GithubRepoInfo[] = [{ fullName: repo, pushedAt: Date.now(), private: false }]

  const [commitPage, prPage] = await Promise.all([
    fetchPages<any>(`/repos/${repo}/commits`, 2, 100),
    fetchPages<any>(`/repos/${repo}/pulls?state=all`, 2, 50),
  ])

  if (commitPage.error && commitPage.rows.length === 0) {
    return {
      ...offScan(`${repo}: ${commitPage.error}`, pinned, login),
      repo,
    }
  }

  const commits = commitPage.rows.map(asCommit).filter((c): c is GithubCommit => c != null)
  const prs = prPage.rows.map(asPr).filter((p): p is GithubPr => p != null)
  const features = extractFeatures(commits, prs)
  const payload: GithubScan = {
    live: true,
    repo,
    login,
    lastScanAt: Date.now(),
    error: prPage.error ? `PRs: ${prPage.error}` : commitPage.error,
    commits,
    prs,
    features,
    commitsPerDay: commitsPerDay(commits),
    openPRs: prs.filter((p) => p.state === 'open').length,
    repos: pinned,
  }
  cache = { key: repo, at: Date.now(), payload }
  return payload
}

export interface GithubShipInput {
  slug: string
  name: string
  summary: string
  brief: string
  file: string
}

export interface GithubShipResult {
  live: boolean
  merged: boolean
  number: number
  title: string
  branch: string
  file: string
  sha: string
  url: string | null
  error: string | null
}

export function isSdkShipFile(file: string): boolean {
  const f = file.replace(/^\/+/, '')
  return f.startsWith('agentbasis/') && !f.includes('..') && f.endsWith('.py')
}

export function featureModule(input: { slug: string; name: string; summary: string; brief: string }): string {
  const slug = input.slug.replace(/[^a-z0-9_-]/gi, '_')
  return `"""${input.name}

${input.summary}

${input.brief}

Shipped by Business_Agent Repo Agent after Changelog Scout / Gap Analyst / Brief Writer research.
"""
from __future__ import annotations

from typing import Any, Optional


FEATURE = "${slug}"


def apply(span: Optional[Any] = None, **attrs: Any) -> None:
    """Record ${input.name} on an OpenTelemetry span."""
    if span is None:
        return
    set_attr = getattr(span, "set_attribute", None)
    if not callable(set_attr):
        return
    set_attr("agentbasis.feature", FEATURE)
    for key, value in attrs.items():
        if value is None:
            continue
        set_attr(f"agentbasis.{key}", value)
`
}

function emptyShip(file: string, error: string): GithubShipResult {
  return {
    live: isGithubLive(),
    merged: false,
    number: 0,
    title: '',
    branch: '',
    file,
    sha: '',
    url: null,
    error,
  }
}

export async function shipFeature(input: GithubShipInput): Promise<GithubShipResult> {
  if (!isGithubLive()) {
    return emptyShip(input.file, 'Set GITHUB_TOKEN in the workspace .env, then restart the backend.')
  }

  const repo = FOCUS_REPO
  const meta = await ghget(`/repos/${repo}`)
  if (!meta.ok) return emptyShip(input.file, errMsg(meta.json, `GitHub ${meta.status}`))
  const base = String(meta.json?.default_branch ?? 'main')
  const ref = await ghget(`/repos/${repo}/git/ref/heads/${encodeURIComponent(base)}`)
  if (!ref.ok) return emptyShip(input.file, errMsg(ref.json, `GitHub ${ref.status}`))
  const sha = String(ref.json?.object?.sha ?? '')
  if (!sha) return emptyShip(input.file, `No SHA for ${base}`)

  const stem = `business_agent/${input.slug}`.replace(/[^a-z0-9/_-]+/gi, '-').replace(/\/{2,}/g, '/').slice(0, 48)
  let branch = stem
  let created = await ghreq(`/repos/${repo}/git/refs`, {
    method: 'POST',
    body: { ref: `refs/heads/${branch}`, sha },
    timeoutMs: 45000,
  })
  if (!created.ok) {
    branch = `${stem}-${Date.now().toString(36).slice(-5)}`.slice(0, 60)
    created = await ghreq(`/repos/${repo}/git/refs`, {
      method: 'POST',
      body: { ref: `refs/heads/${branch}`, sha },
      timeoutMs: 45000,
    })
    if (!created.ok) return emptyShip(input.file, errMsg(created.json, `GitHub ${created.status}`))
  }

  let file = input.file.replace(/^\/+/, '')
  if (!isSdkShipFile(file)) {
    return emptyShip(file, 'Ship files must be python modules under agentbasis/')
  }
  const putBody = {
    message: `feat: ${input.name}\n\n${input.summary}\n\n${input.brief}`,
    content: Buffer.from(featureModule(input), 'utf8').toString('base64'),
    branch,
  }
  let put = await ghreq(`/repos/${repo}/contents/${file}`, { method: 'PUT', body: putBody, timeoutMs: 45000 })
  if (!put.ok && (put.status === 422 || put.status === 409)) {
    const tagged = file.replace(/\.py$/, `_${Date.now().toString(36).slice(-4)}.py`)
    put = await ghreq(`/repos/${repo}/contents/${tagged}`, { method: 'PUT', body: putBody, timeoutMs: 45000 })
    if (put.ok) file = tagged
  }
  if (!put.ok) return emptyShip(file, errMsg(put.json, `GitHub ${put.status}`))
  const commitSha = String(put.json?.commit?.sha ?? put.json?.content?.sha ?? '')

  const pr = await ghreq(`/repos/${repo}/pulls`, {
    method: 'POST',
    body: {
      title: `feat: ${input.name}`,
      head: branch,
      base,
      body:
        `## Research\n${input.brief}\n\n## Summary\n${input.summary}\n\n` +
        `Opened and merged by Business_Agent Repo Agent on ${repo}.`,
    },
    timeoutMs: 45000,
  })
  if (!pr.ok) return emptyShip(file, errMsg(pr.json, `GitHub ${pr.status}`))
  const number = Number(pr.json?.number)
  const url = pr.json?.html_url != null ? String(pr.json.html_url) : null
  const title = String(pr.json?.title ?? `feat: ${input.name}`)

  const merged = await ghreq(`/repos/${repo}/pulls/${number}/merge`, {
    method: 'PUT',
    body: { merge_method: 'squash', commit_title: `feat: ${input.name} (#${number})` },
    timeoutMs: 45000,
  })
  cache = null
  return {
    live: true,
    merged: merged.ok,
    number,
    title,
    branch,
    file,
    sha: String(merged.json?.sha ?? commitSha).slice(0, 40),
    url,
    error: merged.ok ? null : errMsg(merged.json, `merge ${merged.status}`),
  }
}

