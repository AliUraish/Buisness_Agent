// Local human-review store — the working replacement for Terac forms.
// The engine files a review, the human answers at /review, the engine
// polls the verdict. In-memory; a backend restart clears pending reviews.

export interface ReviewRecord {
  id: string
  kind: 'ship' | 'trade' | 'claim' | 'allocation'
  payload: Record<string, string>
  status: 'pending' | 'done'
  verdict: string | null
  notes: string | null
  confidence: string | null
  createdAt: number
  answeredAt: number | null
}

const store = new Map<string, ReviewRecord>()

export function createReview(kind: ReviewRecord['kind'], payload: Record<string, string>): ReviewRecord {
  const id = 'rv_' + Math.random().toString(36).slice(2, 10)
  const rec: ReviewRecord = {
    id,
    kind,
    payload,
    status: 'pending',
    verdict: null,
    notes: null,
    confidence: null,
    createdAt: Date.now(),
    answeredAt: null,
  }
  store.set(id, rec)
  // keep the store tidy: drop answered reviews older than an hour
  for (const [k, v] of store) {
    if (v.status === 'done' && Date.now() - (v.answeredAt ?? 0) > 3600_000) store.delete(k)
  }
  return rec
}

export function pendingReview(): ReviewRecord | null {
  let newest: ReviewRecord | null = null
  for (const v of store.values()) {
    if (v.status === 'pending' && (!newest || v.createdAt > newest.createdAt)) newest = v
  }
  return newest
}

export function getReview(id: string): ReviewRecord | null {
  return store.get(id) ?? null
}

export function submitReview(id: string, verdict: string, notes: string, confidence: string): ReviewRecord | null {
  const rec = store.get(id)
  if (!rec || rec.status === 'done') return rec ?? null
  rec.status = 'done'
  rec.verdict = verdict.slice(0, 60)
  rec.notes = notes.slice(0, 300)
  rec.confidence = confidence.slice(0, 40)
  rec.answeredAt = Date.now()
  return rec
}
