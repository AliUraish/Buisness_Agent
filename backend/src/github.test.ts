import { describe, expect, it } from 'vitest'
import { commitsPerDay, extractFeatures, featureModule, isSdkShipFile, parseConventional, parsePrNumber, pickDefaultRepo } from './github.ts'

describe('parseConventional', () => {
  it('reads feat with a PascalCase scope', () => {
    expect(parseConventional('feat(LiveDataScreens): add real-time data display')).toEqual({
      type: 'feat',
      scope: 'LiveDataScreens',
      rest: 'add real-time data display',
    })
  })
  it('reads a breaking-change bang', () => {
    expect(parseConventional('feat(api)!: scoped keys')?.type).toBe('feat')
  })
  it('rejects a free-form subject', () => {
    expect(parseConventional('updated the readme')).toBeNull()
  })
})

describe('parsePrNumber', () => {
  it('reads a trailing (#12) and a merge line', () => {
    expect(parsePrNumber('feat: webhooks (#12)')).toBe(12)
    expect(parsePrNumber('Merge pull request #63 from ali/webhooks')).toBe(63)
  })
})

describe('extractFeatures', () => {
  const t = Date.now()
  it('groups feat commits by scope and skips chore/docs/tests', () => {
    const features = extractFeatures(
      [
        { sha: 'aaa1111bbbb', message: 'feat(LiveDataScreens): add real-time data display', at: t, pr: null },
        { sha: 'bbb2222cccc', message: 'feat(LiveDataScreens): wire websocket feed', at: t - 1000, pr: null },
        { sha: 'ccc3333dddd', message: 'chore: bump deps', at: t, pr: null },
        { sha: 'ddd4444eeee', message: 'docs(README): rewrite intro', at: t, pr: null },
        { sha: 'eee5555ffff', message: 'feat(tests): add store fallback tests', at: t, pr: null },
        { sha: 'fff6666gggg', message: 'feat(Investigations): implement investigations screen', at: t - 500, pr: 4 },
      ],
      [],
    )
    expect(features.map((f) => f.name)).toEqual(['LiveDataScreens', 'Investigations'])
    const live = features[0]
    expect(live.commitCount).toBe(2)
    expect(live.chips).toContain('aaa1111')
    expect(live.chips.some((c) => c.includes('2 commits'))).toBe(true)
    expect(features[1].chips).toContain('PR #4')
  })

  it('turns a merged PR title into a feature when there is no feat commit', () => {
    const features = extractFeatures(
      [],
      [{ number: 9, title: 'Add CSV export of usage data', merged: true, at: t }],
    )
    expect(features).toHaveLength(1)
    expect(features[0].name).toMatch(/csv export/i)
    expect(features[0].pr).toBe(9)
  })

  it('does not queue open PRs as committed features', () => {
    const features = extractFeatures(
      [],
      [{ number: 2, title: 'feat: dark mode', merged: false, at: t }],
    )
    expect(features).toHaveLength(0)
  })

  it('reads merged PRs + Add/Enhance commits, skips tests', () => {
    const features = extractFeatures(
      [
        { sha: 'fe606e9xxxx', message: 'Merge pull request #4 from acme/anthropic_tool_improvement', at: t, pr: 4 },
        { sha: '8fdaa22xxxx', message: 'Enhance OpenTelemetry tracing by adding tool count attributes', at: t - 1, pr: null },
        { sha: 'e803f5cxxxx', message: 'all tests passed', at: t - 2, pr: null },
        { sha: '12d5c05xxxx', message: 'Add unit tests for tool count and tool use names', at: t - 3, pr: null },
      ],
      [{ number: 4, title: 'Anthropic tool improvement', merged: true, at: t }],
    )
    expect(features.map((f) => f.name)).toEqual(['Anthropic tool improvement', 'OpenTelemetry tracing by adding tool count attributes'])
    expect(features[0].pr).toBe(4)
    expect(features[0].sha.slice(0, 7)).toBe('fe606e9')
    expect(features.some((f) => /unit tests|all tests/i.test(f.name))).toBe(false)
  })
})

describe('commitsPerDay', () => {
  it('buckets a commit from today into the last slot', () => {
    const days = commitsPerDay([{ at: Date.now() }], 14)
    expect(days).toHaveLength(14)
    expect(days[13]).toBe(1)
    expect(days.slice(0, 13).every((n) => n === 0)).toBe(true)
  })
})

describe('pickDefaultRepo', () => {
  it('is pinned to AliUraish/Buisness_Agent', () => {
    expect(pickDefaultRepo('AliUraish', [{ fullName: 'AliUraish/Agentalize', pushedAt: 8, private: false }], 'AliUraish/PocketX')).toBe(
      'AliUraish/Buisness_Agent',
    )
  })
})

describe('isSdkShipFile', () => {
  it('only allows files under product/', () => {
    expect(isSdkShipFile('product/llms/openai/tool_spans.py')).toBe(true)
    expect(isSdkShipFile('/product/context_redaction.py')).toBe(true)
    expect(isSdkShipFile('product/terac-ship-form.md')).toBe(true)
    expect(isSdkShipFile('src/auth/sso.ts')).toBe(false)
    expect(isSdkShipFile('product/../secrets.py')).toBe(false)
    expect(isSdkShipFile('agentbasis/readme.md')).toBe(false)
  })
})

describe('featureModule', () => {
  it('is valid-enough python that names the feature and the research brief', () => {
    const src = featureModule({
      slug: 'openai-tool-spans',
      name: 'OpenAI tool_use spans',
      summary: 'tool_use names on the request span',
      brief: 'OpenLLMetry already records tool names; we did not.',
    })
    expect(src).toContain('FEATURE = "openai-tool-spans"')
    expect(src).toContain('OpenAI tool_use spans')
    expect(src).toContain('OpenLLMetry')
    expect(src).toContain('def apply(')
  })
})
