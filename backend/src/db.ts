// The company's persistent memory: Neon Postgres. Two tables —
// an append-only event journal (the activity feed, forever) and a
// key/value state store the engine snapshots its domains into.
// Everything degrades gracefully: no NEON_URL → in-memory only.

import { neon } from '@neondatabase/serverless'
import { NEON_URL } from './env.ts'

const sql = NEON_URL ? neon(NEON_URL) : null
let schemaReady = false
let initError: string | null = null

export function dbConfigured(): boolean {
  return Boolean(sql)
}

async function ensureSchema(): Promise<boolean> {
  if (!sql) return false
  if (schemaReady) return true
  try {
    await sql`CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY,
      at TIMESTAMPTZ NOT NULL DEFAULT now(),
      dept TEXT NOT NULL,
      agent TEXT NOT NULL,
      message TEXT NOT NULL,
      chips JSONB,
      delta TEXT
    )`
    await sql`CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`
    schemaReady = true
    initError = null
    return true
  } catch (e) {
    initError = (e instanceof Error ? e.message : String(e)).slice(0, 160)
    return false
  }
}

export async function dbStatus(): Promise<{ live: boolean; error: string | null; events: number }> {
  if (!sql) return { live: false, error: 'Set NEON_URL in the workspace .env.', events: 0 }
  if (!(await ensureSchema())) return { live: false, error: initError, events: 0 }
  try {
    const rows = await sql`SELECT count(*)::int AS n FROM events`
    return { live: true, error: null, events: rows[0]?.n ?? 0 }
  } catch (e) {
    return { live: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 160), events: 0 }
  }
}

export async function saveEvent(ev: { dept: string; agent: string; message: string; chips?: unknown; delta?: string }): Promise<boolean> {
  if (!(await ensureSchema()) || !sql) return false
  try {
    await sql`INSERT INTO events (dept, agent, message, chips, delta)
      VALUES (${ev.dept}, ${ev.agent}, ${ev.message}, ${JSON.stringify(ev.chips ?? [])}::jsonb, ${ev.delta ?? null})`
    return true
  } catch {
    return false
  }
}

export async function listEvents(limit: number): Promise<any[]> {
  if (!(await ensureSchema()) || !sql) return []
  const n = Math.min(Math.max(limit, 1), 200)
  const rows = await sql`SELECT id, at, dept, agent, message, chips, delta
    FROM events ORDER BY id DESC LIMIT ${n}`
  return rows.reverse()
}

export async function putState(key: string, value: unknown): Promise<boolean> {
  if (!(await ensureSchema()) || !sql) return false
  try {
    await sql`INSERT INTO state (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
    return true
  } catch {
    return false
  }
}

export async function getStateAll(): Promise<Record<string, unknown>> {
  if (!(await ensureSchema()) || !sql) return {}
  const rows = await sql`SELECT key, value FROM state`
  const out: Record<string, unknown> = {}
  for (const r of rows) out[r.key] = r.value
  return out
}
