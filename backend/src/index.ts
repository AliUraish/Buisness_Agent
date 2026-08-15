import http from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PORT } from './env.ts'
import {
  hireClaimReview,
  hireShipReview,
  hireTradeReview,
  isLive,
  pollClaimReview,
  pollShipReview,
  pollTradeReview,
  type HireInput,
  type ShipInput,
  type TradeInput,
} from './terac.ts'
import { isLinqLive, paymentLink, sendOnboard, sendSupportMessage } from './linq.ts'
import { isStripeLive, isWhopLive, stripeSummary, stripeToday, whopSummary } from './payments.ts'
import { complete, llmStatus, type Provider, type Tier } from './llm.ts'
import { dbStatus, getStateAll, listEvents, putState, saveEvent } from './db.ts'
import { perfloSummary } from './perflo.ts'
import { research, researchStatus } from './research.ts'
import { hireAllocationReview, pollAllocationReview, type AllocationInput } from './terac.ts'
import { isXLive, loadTryteracAudience, snapshotStatus } from './x.ts'
import { FOCUS_REPO, isGithubLive, listRepos, mergePullRequest, scanRepo, shipFeature } from './github.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS })
  res.end(status === 204 ? undefined : JSON.stringify(body))
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function githubHref(raw: string, fallback: string) {
  try {
    const u = new URL(raw)
    if (u.protocol === 'https:' && u.hostname === 'github.com') return u.toString()
  } catch {
    // fall through
  }
  return fallback
}

async function sendReview(res: http.ServerResponse, url: URL) {
  let html = readFileSync(fileURLToPath(new URL('./review.html', import.meta.url)), 'utf8')
  const q = url.searchParams
  let feature = q.get('feature') || ''
  let pr = q.get('pr') || ''
  let prTitle = q.get('prTitle') || ''
  let files = q.get('files') || ''
  let brief = q.get('brief') || q.get('post') || ''
  let repo = q.get('repo') || FOCUS_REPO
  let prUrl = q.get('prUrl') || ''

  if (!feature || !pr) {
    try {
      const scan = await scanRepo()
      repo = scan.repo || repo
      const feat = scan.features[0]
      const open = scan.prs.find((p) => p.state === 'open') ?? scan.prs[0]
      if (!feature) feature = feat?.name || open?.title || 'Latest change'
      if (!pr && (feat?.pr || open?.number)) pr = String(feat?.pr ?? open?.number ?? '')
      if (!prTitle) prTitle = open?.title || feat?.summary || ''
      if (!brief) brief = feat?.summary || open?.title || ''
    } catch {
      // placeholders below are enough
    }
  }

  const repoUrl = repo ? `https://github.com/${repo}` : '#'
  if (!prUrl) prUrl = pr && repo ? `${repoUrl}/pull/${pr}` : repoUrl
  prUrl = githubHref(prUrl, repoUrl)
  const prLine = [pr ? `PR #${pr}` : '', prTitle].filter(Boolean).join(' · ') || 'Open the repo for the latest commit / PR'

  html = html
    .replaceAll('__FEATURE__', esc(feature || 'Latest change'))
    .replaceAll('__PR_LINE__', esc(prLine))
    .replaceAll('__BRIEF__', esc(brief || 'Open the PR, read the diff, then answer below.'))
    .replaceAll('__PR_URL__', prUrl)
    .replaceAll('__REPO_URL__', repoUrl)
    .replaceAll('__FILES__', esc(files || '(listed in the PR)'))

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
  res.end(html)
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1_000_000) throw new Error('payload too large')
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  return JSON.parse(raw)
}

function asHireInput(body: any): HireInput {
  return {
    feature: String(body?.feature ?? ''),
    post: String(body?.post ?? ''),
    voice: String(body?.voice ?? ''),
    clusterTitle: String(body?.clusterTitle ?? 'reviewer'),
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  if (req.method === 'OPTIONS') {
    send(res, 204, null)
    return
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      send(res, 200, { ok: true })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/x/status') {
      send(res, 200, { live: isXLive(), handle: '@tryterac', ...snapshotStatus() })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/x/audience') {
      send(res, 200, await loadTryteracAudience({ refresh: url.searchParams.get('refresh') === '1' }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/github/status') {
      send(res, 200, { live: isGithubLive() })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/github/repos') {
      send(res, 200, await listRepos())
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/github/scan') {
      send(res, 200, await scanRepo(url.searchParams.get('repo')))
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/github/ship') {
      const b = await readJson(req)
      send(
        res,
        200,
        await shipFeature({
          slug: String(b?.slug ?? 'feature'),
          name: String(b?.name ?? 'feature'),
          summary: String(b?.summary ?? ''),
          brief: String(b?.brief ?? ''),
          file: String(b?.file ?? 'product/feature.md'),
        }),
      )
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/github/merge') {
      const b = await readJson(req)
      send(res, 200, await mergePullRequest(Number(b?.number ?? 0)))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/terac/status') {
      send(res, 200, { live: isLive() })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/linq/status') {
      send(res, 200, { live: isLinqLive(), paymentLink: paymentLink() })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/pay/status') {
      send(res, 200, { stripe: isStripeLive(), whop: isWhopLive() })
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/terac/allocations') {
      const b = await readJson(req)
      const input: AllocationInput = {
        bankName: String(b?.bankName ?? 'the operating account'),
        balance: Number(b?.balance ?? 0),
        alloc: Array.isArray(b?.alloc) ? b.alloc.map((a: any) => ({ label: String(a?.label ?? ''), pct: Number(a?.pct ?? 0) })) : [],
        rationale: String(b?.rationale ?? '').slice(0, 1500),
      }
      send(res, 200, await hireAllocationReview(input))
      return
    }
    const alloc = url.pathname.match(/^\/api\/terac\/allocations\/([^/]+)$/)
    if (req.method === 'GET' && alloc) {
      send(res, 200, await pollAllocationReview(decodeURIComponent(alloc[1])))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/research/status') {
      send(res, 200, researchStatus())
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/research') {
      const b = await readJson(req)
      send(res, 200, await research(String(b?.query ?? ''), String(b?.system ?? 'You are a competitive intelligence researcher. Be concrete and cite sources.')))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/perflo/summary') {
      send(res, 200, await perfloSummary())
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/db/status') {
      send(res, 200, await dbStatus())
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/db/events') {
      const b = await readJson(req)
      send(res, 200, {
        ok: await saveEvent({
          dept: String(b?.dept ?? 'ceo'),
          agent: String(b?.agent ?? ''),
          message: String(b?.message ?? ''),
          chips: b?.chips,
          delta: b?.delta != null ? String(b.delta) : undefined,
        }),
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/db/events') {
      send(res, 200, await listEvents(Number(url.searchParams.get('limit') ?? 100)))
      return
    }
    if (req.method === 'PUT' && url.pathname === '/api/db/state') {
      const b = await readJson(req)
      send(res, 200, { ok: await putState(String(b?.key ?? ''), b?.value) })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/db/state') {
      send(res, 200, await getStateAll())
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/llm/status') {
      send(res, 200, llmStatus())
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/llm/complete') {
      const b = await readJson(req)
      const result = await complete({
        provider: (['anthropic', 'openai', 'gemini'].includes(b?.provider) ? b.provider : 'anthropic') as Provider,
        tier: (b?.tier === 'smart' ? 'smart' : 'cheap') as Tier,
        system: String(b?.system ?? '').slice(0, 2000),
        prompt: String(b?.prompt ?? '').slice(0, 6000),
        maxTokens: Number(b?.maxTokens ?? 200),
      })
      send(res, 200, result)
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/pay/today') {
      send(res, 200, await stripeToday())
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/pay/summary') {
      const [stripe, whop] = await Promise.all([stripeSummary(), whopSummary()])
      send(res, 200, { stripe, whop })
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/linq/send') {
      const b = await readJson(req)
      send(res, 200, await sendSupportMessage(String(b?.text ?? '')))
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/linq/onboard') {
      send(res, 200, await sendOnboard())
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/terac/hires') {
      const result = await hireClaimReview(asHireInput(await readJson(req)))
      send(res, 200, result)
      return
    }
    const job = url.pathname.match(/^\/api\/terac\/hires\/([^/]+)$/)
    if (req.method === 'GET' && job) {
      const result = await pollClaimReview(decodeURIComponent(job[1]))
      send(res, 200, result)
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/terac/trades') {
      const b = await readJson(req)
      const input: TradeInput = {
        symbol: String(b?.symbol ?? ''),
        name: String(b?.name ?? ''),
        amount: Number(b?.amount ?? 0),
        roi: Number(b?.roi ?? 0),
        ranking: String(b?.ranking ?? ''),
      }
      send(res, 200, await hireTradeReview(input))
      return
    }
    const trade = url.pathname.match(/^\/api\/terac\/trades\/([^/]+)$/)
    if (req.method === 'GET' && trade) {
      send(res, 200, await pollTradeReview(decodeURIComponent(trade[1])))
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/terac/ships') {
      const b = await readJson(req)
      const input: ShipInput = {
        kind: 'verify',
        feature: String(b?.feature ?? ''),
        rival: String(b?.rival ?? ''),
        brief: String(b?.brief ?? ''),
        prTitle: b?.prTitle != null ? String(b.prTitle) : undefined,
        prNumber: b?.prNumber != null ? Number(b.prNumber) : undefined,
        files: b?.files != null ? String(b.files) : undefined,
      }
      send(res, 200, await hireShipReview(input))
      return
    }
    const ship = url.pathname.match(/^\/api\/terac\/ships\/([^/]+)$/)
    if (req.method === 'GET' && ship) {
      send(res, 200, await pollShipReview(decodeURIComponent(ship[1])))
      return
    }
    if (req.method === 'GET' && (url.pathname === '/review' || url.pathname === '/review.html')) {
      await sendReview(res, url)
      return
    }
    send(res, 404, { error: 'not found' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    send(res, 500, { error: msg })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[backend] http://127.0.0.1:${PORT}  terac ${isLive() ? 'live' : 'off'}  x ${isXLive() ? 'live' : 'off'}  github ${isGithubLive() ? 'live' : 'off'}`,
  )
})
