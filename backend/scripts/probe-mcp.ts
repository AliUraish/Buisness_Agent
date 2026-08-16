import { TERAC_API_KEY } from '../src/env.ts'

const MCP = 'https://terac.com/api/mcp'

async function tryOnce(label: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const text = await res.text()
  const hdrs: Record<string, string> = {}
  res.headers.forEach((v, k) => {
    if (!/auth|key|cookie/i.test(k)) hdrs[k] = v
  })
  return { label, status: res.status, headers: hdrs, body: text.slice(0, 4000) }
}

async function main() {
  const init = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'bob-the-busines', version: '0.6.0' },
    },
  }
  const results: unknown[] = [
    { hasKey: Boolean(TERAC_API_KEY), keyPrefix: TERAC_API_KEY.slice(0, 3), keyLen: TERAC_API_KEY.length },
  ]
  if (!TERAC_API_KEY) {
    console.log(JSON.stringify({ error: 'no key' }))
    return
  }
  const headerSets = [
    {
      name: 'x-api-key',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-api-key': TERAC_API_KEY,
      },
    },
    {
      name: 'bearer',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${TERAC_API_KEY}`,
      },
    },
  ]
  for (const h of headerSets) {
    try {
      results.push(await tryOnce('init-' + h.name, h.headers, init))
    } catch (e) {
      results.push({ label: 'init-' + h.name, error: e instanceof Error ? e.message : String(e) })
    }
  }
  console.log(JSON.stringify(results, null, 2))
}

main()
