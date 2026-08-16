import { describe, expect, it } from 'vitest'
import { argsForTool, normalizeSubmissions, parseMcpBody, unwrapToolResult } from './terac-mcp.ts'

describe('parseMcpBody', () => {
  it('reads a JSON-RPC object', () => {
    const json = parseMcpBody('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')
    expect(json?.result).toEqual({ ok: true })
  })

  it('reads the last SSE data frame with a result', () => {
    const json = parseMcpBody('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"terac_get_context"}]}}\n\n')
    expect((json?.result as { tools: { name: string }[] }).tools[0].name).toBe('terac_get_context')
  })
})

describe('unwrapToolResult', () => {
  it('parses a single text content block as JSON', () => {
    expect(unwrapToolResult({ content: [{ type: 'text', text: '{"organization":{"name":"Bob"}}' }] })).toEqual({
      organization: { name: 'Bob' },
    })
  })

  it('prefers structuredContent', () => {
    expect(unwrapToolResult({ structuredContent: { credits: 12 }, content: [{ type: 'text', text: 'ignore' }] })).toEqual({
      credits: 12,
    })
  })
})

describe('normalizeSubmissions', () => {
  it('accepts data, submissions, or a bare array', () => {
    expect(normalizeSubmissions([{ id: '1' }])).toEqual([{ id: '1' }])
    expect(normalizeSubmissions({ data: [{ id: '2' }] })).toEqual([{ id: '2' }])
    expect(normalizeSubmissions({ submissions: [{ id: '3' }] })).toEqual([{ id: '3' }])
  })
})

describe('argsForTool', () => {
  it('maps opportunityId onto the schema key', () => {
    const tool = {
      name: 'terac_get_submissions',
      inputSchema: { properties: { opportunity_id: { type: 'string' } } },
    }
    expect(argsForTool(tool, { opportunityId: 'opp_1' })).toEqual({ opportunity_id: 'opp_1' })
  })
})
