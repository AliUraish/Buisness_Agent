import http from 'node:http'
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
import { isLinqLive, sendSupportMessage } from './linq.ts'
import { isStripeLive, isWhopLive, stripeSummary, stripeToday, whopSummary } from './payments.ts'
import { isXLive, loadTryteracAudience, snapshotStatus } from './x.ts'
import { isGithubLive, listRepos, scanRepo } from './github.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS })
  res.end(status === 204 ? undefined : JSON.stringify(body))
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
    if (req.method === 'GET' && url.pathname === '/api/terac/status') {
      send(res, 200, { live: isLive() })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/linq/status') {
      send(res, 200, { live: isLinqLive() })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/pay/status') {
      send(res, 200, { stripe: isStripeLive(), whop: isWhopLive() })
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
