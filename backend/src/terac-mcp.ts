// Terac MCP client. Same org and humans as REST — different door.
// Cursor talks to https://terac.com/api/mcp directly; the company loop
// uses this module so status + submission polls also go through MCP.

import { TERAC_API_KEY } from './env.ts'

export const TERAC_MCP_URL = 'https://terac.com/api/mcp'

export interface TeracMcpStatus {
  live: boolean
  url: string
  org: string | null
  credits: number | null
  tools: string[]
  error: string | null
}

export interface McpTool {
  name: string
  description?: string
  inputSchema?: {
    type?: string
    properties?: Record<string, unknown>
    required?: string[]
  }
}

type JsonRpc = {
  jsonrpc?: string
  id?: number | string
  result?: unknown
  error?: { code?: number; message?: string }
}

let sessionId: string | null = null
let toolsCache: McpTool[] | null = null
let rpcId = 1
let statusCache: { at: number; value: TeracMcpStatus } | null = null

const STATUS_TTL_MS = 60_000

export function parseMcpBody(text: string): JsonRpc | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as JsonRpc
    } catch {
      // fall through to SSE
    }
  }
  const chunks: JsonRpc[] = []
  for (const line of trimmed.split(/\r?\n/)) {
    const payload = line.startsWith('data:') ? line.slice(5).trim() : ''
    if (!payload || payload === '[DONE]') continue
    try {
      chunks.push(JSON.parse(payload) as JsonRpc)
    } catch {
      // ignore keepalives
    }
  }
  return chunks.find((c) => c.result != null || c.error != null) ?? chunks.at(-1) ?? null
}

export function unwrapToolResult(result: unknown): unknown {
  if (result == null) return null
  if (typeof result !== 'object') return result
  const rec = result as { content?: unknown; structuredContent?: unknown }
  if (rec.structuredContent != null) return rec.structuredContent
  const content = rec.content
  if (!Array.isArray(content)) return result
  const texts = content
    .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text?: unknown }).text ?? '') : ''))
    .filter(Boolean)
  if (texts.length === 1) {
    const t = texts[0]
    try {
      return JSON.parse(t)
    } catch {
      return t
    }
  }
  if (texts.length > 1) return texts.join('\n')
  return result
}

export function normalizeSubmissions(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const rec = raw as Record<string, unknown>
    for (const key of ['data', 'submissions', 'items', 'results']) {
      if (Array.isArray(rec[key])) return rec[key] as any[]
    }
  }
  return []
}

export function argsForTool(tool: McpTool | undefined, candidates: Record<string, unknown>): Record<string, unknown> {
  const props = tool?.inputSchema?.properties ?? {}
  const keys = Object.keys(props)
  if (keys.length === 0) {
    return Object.fromEntries(Object.entries(candidates).filter(([, v]) => v != null && v !== ''))
  }
  const aliases: Record<string, string[]> = {
    opportunityId: ['opportunity_id', 'opportunityid', 'id'],
    opportunity_id: ['opportunityId', 'opportunityid', 'id'],
    id: ['opportunityId', 'opportunity_id'],
    submissionId: ['submission_id', 'id'],
    submission_id: ['submissionId', 'id'],
  }
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (candidates[key] != null && candidates[key] !== '') {
      out[key] = candidates[key]
      continue
    }
    const alt = (aliases[key] ?? []).find((a) => candidates[a] != null && candidates[a] !== '')
    if (alt) out[key] = candidates[alt]
  }
  return out
}

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-03-26',
    'x-api-key': TERAC_API_KEY,
    Authorization: `Bearer ${TERAC_API_KEY}`,
  }
}

async function mcpPost(body: object, timeoutMs = 12000): Promise<{ json: JsonRpc | null; status: number; session: string | null }> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const headers = authHeaders()
    if (sessionId) headers['mcp-session-id'] = sessionId
    const res = await fetch(TERAC_MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctl.signal,
    })
    const next = res.headers.get('mcp-session-id')
    if (next) sessionId = next
    const text = await res.text()
    return { json: parseMcpBody(text), status: res.status, session: sessionId }
  } finally {
    clearTimeout(t)
  }
}

function resetSession() {
  sessionId = null
  toolsCache = null
}

async function ensureSession(): Promise<McpTool[]> {
  if (!TERAC_API_KEY) throw new Error('Set TERAC_API_KEY=tk_… in the workspace .env.')
  if (toolsCache) return toolsCache

  const init = await mcpPost({
    jsonrpc: '2.0',
    id: rpcId++,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'bob-the-busines', version: '0.6.0' },
    },
  })
  if (init.status === 401 || init.json?.error?.message?.toLowerCase().includes('auth')) {
    resetSession()
    throw new Error(init.json?.error?.message ?? 'Terac MCP authentication required.')
  }
  if (init.status >= 400 || init.json?.error) {
    resetSession()
    throw new Error(init.json?.error?.message ?? `Terac MCP ${init.status}`)
  }

  await mcpPost({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }).catch(() => undefined)

  const listed = await mcpPost({
    jsonrpc: '2.0',
    id: rpcId++,
    method: 'tools/list',
    params: {},
  })
  const tools = ((listed.json?.result as { tools?: McpTool[] } | undefined)?.tools ?? []) as McpTool[]
  toolsCache = tools
  return tools
}

export async function mcpCall(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const tools = await ensureSession()
  const tool = tools.find((t) => t.name === name)
  const mapped = argsForTool(tool, args)
  const res = await mcpPost({
    jsonrpc: '2.0',
    id: rpcId++,
    method: 'tools/call',
    params: { name, arguments: mapped },
  })
  if (res.status === 401) {
    resetSession()
    throw new Error(res.json?.error?.message ?? 'Terac MCP authentication required.')
  }
  if (res.json?.error) throw new Error(res.json.error.message ?? `Terac MCP ${name} failed`)
  return unwrapToolResult(res.json?.result)
}

function readOrg(raw: unknown): { org: string | null; credits: number | null } {
  if (!raw || typeof raw !== 'object') return { org: null, credits: null }
  const rec = raw as Record<string, any>
  const org =
    rec.organization?.name ??
    rec.organizationName ??
    rec.org?.name ??
    rec.name ??
    rec.organization ??
    null
  const creditsRaw = rec.creditBalance ?? rec.credits ?? rec.balance ?? rec.organization?.creditBalance
  const credits = Number(creditsRaw)
  return {
    org: typeof org === 'string' ? org : null,
    credits: Number.isFinite(credits) ? credits : null,
  }
}

export async function teracMcpStatus(force = false): Promise<TeracMcpStatus> {
  const now = Date.now()
  if (!force && statusCache && now - statusCache.at < STATUS_TTL_MS) return statusCache.value

  const base: TeracMcpStatus = {
    live: false,
    url: TERAC_MCP_URL,
    org: null,
    credits: null,
    tools: [],
    error: null,
  }
  if (!TERAC_API_KEY) {
    const value = { ...base, error: 'Set TERAC_API_KEY=tk_… then restart the backend.' }
    statusCache = { at: now, value }
    return value
  }

  try {
    const tools = await ensureSession()
    let org: string | null = null
    let credits: number | null = null
    if (tools.some((t) => t.name === 'terac_get_context')) {
      const ctx = await mcpCall('terac_get_context')
      const parsed = readOrg(ctx)
      org = parsed.org
      credits = parsed.credits
    }
    const value: TeracMcpStatus = {
      live: true,
      url: TERAC_MCP_URL,
      org,
      credits,
      tools: tools.map((t) => t.name),
      error: null,
    }
    statusCache = { at: now, value }
    return value
  } catch (e) {
    resetSession()
    const value = { ...base, error: e instanceof Error ? e.message.slice(0, 180) : String(e).slice(0, 180) }
    statusCache = { at: now, value }
    return value
  }
}

export async function mcpListSubmissions(jobId: string): Promise<any[] | null> {
  if (!jobId) return null
  try {
    const tools = await ensureSession()
    const name = tools.find((t) => t.name === 'terac_get_submissions')?.name
    if (!name) return null
    const raw = await mcpCall(name, { opportunityId: jobId, opportunity_id: jobId, id: jobId })
    return normalizeSubmissions(raw)
  } catch {
    return null
  }
}
