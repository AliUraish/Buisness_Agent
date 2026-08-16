import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BugCheck, Feature, ShipJob, engine, teracVerifyLabel } from '../sim/engine'
import { GithubCommit, GithubPr } from '../sim/github'
import { useEngineTick } from '../App'

const STAGES = ['Detected', 'Campaign', 'Simulated', 'Posted']

function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

function ago(ts: number, now: number): string {
  if (!ts) return '—'
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s ago`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m ago`
}

function subject(message: string) {
  return (message.split('\n')[0] ?? '').slice(0, 88)
}

function TeracVerifyMark({ job }: { job: Pick<ShipJob, 'gate' | 'pr'> }) {
  const v = teracVerifyLabel(job)
  if (v === 'verified') return <span className="v-confirmed">Terac verified</span>
  if (v === 'reviewing') return <span className="v-reviewing">Terac reviewing</span>
  if (v === 'not-verified') return <span className="v-notrepro">Terac not verified</span>
  return null
}

function GithubBanner() {
  const s = useEngineTick()
  const g = s.github
  const now = useNow(1000)
  const job = [...s.shipJobs].reverse().find((j) => j.stage !== 'shipped' && j.stage !== 'rejected' && j.stage !== 'blocked')
  const busy = s.shipJobs.some((j) =>
    j.stage === 'researching' || j.stage === 'briefed' || j.stage === 'building' || j.stage === 'hiring-verify' || j.stage === 'awaiting-verify',
  )
  return (
    <div className="ship-banner open gh-banner">
      <div className="ship-inner">
        {g.live ? <span className="testmode live">GITHUB LIVE</span> : <span className="testmode off">GITHUB OFF</span>}
        {g.live && (g.canPush ? <span className="testmode live">CAN OPEN PRS</span> : <span className="testmode off">READ ONLY</span>)}
        {s.teracMcp.live ? <span className="testmode live">TERAC MCP</span> : <span className="testmode off">TERAC MCP OFF</span>}
        <span className="ship-title">
          {g.live ? (
            <>
              {job ? (
                <>
                  Shipping <b>{job.feature}</b>
                  {g.repo ? <> to <b>{g.repo}</b></> : null}
                </>
              ) : (
                <>
                  Researching and shipping
                  {g.repo ? <> on <b>{g.repo}</b></> : <> — set GITHUB_REPO</>}
                </>
              )}
            </>
          ) : (
            <>Waiting on GitHub — {g.error ?? 'set GITHUB_TOKEN in .env'}</>
          )}
        </span>
        <span className="ship-ago num">· scanned {ago(g.lastScanAt, now)}</span>
        <button
          className="start-pill"
          type="button"
          disabled={!g.live || !g.canPush || busy}
          onClick={() => engine.shipNext()}
        >
          Open PR
        </button>
      </div>
      {g.live && !g.canPush && (
        <div className="gh-perm-hint">
          Token cannot open PRs. Fine-grained PAT on this repo: Contents (read and write) + Pull requests (read and write). Classic PAT: repo.
        </div>
      )}
    </div>
  )
}

function ShipBanner() {
  const s = useEngineTick()
  const now = useNow(1000)
  const p = s.pipeline
  return (
    <div className={'ship-banner' + (p ? ' open' : '')}>
      {p && (
        <div className="ship-inner">
          <span className="ship-title">
            NEW FEATURE SHIPPED — <b>{p.feature}</b>
          </span>
          <span className="ship-ago num">· {ago(p.at, now)}</span>
          <span className="ship-crumb">
            {STAGES.map((label, i) => {
              const done = p.stage >= i + 1
              return (
                <span className="crumb-step" key={label}>
                  {i > 0 && <span className={'crumb-line' + (done ? ' done' : '')} />}
                  <span className={'crumb-dot' + (done ? ' done' : '')} />
                  <span className={'crumb-label' + (done ? ' done' : '')}>{label}</span>
                </span>
              )
            })}
          </span>
        </div>
      )}
    </div>
  )
}

function Card({ f, refMap }: { f: Feature; refMap: Map<string, HTMLDivElement> }) {
  const isNew = f.shippedAt != null && Date.now() - f.shippedAt < 1600
  return (
    <div
      ref={(el) => {
        if (el) refMap.set(f.id, el)
        else refMap.delete(f.id)
      }}
      className={'kcard' + (f.status === 'claimed' ? ' claimed' : '') + (isNew ? ' fresh' : '')}
    >
      <div className="kcard-name">
        <i
          className="kdot"
          style={{
            background: f.status === 'shipped' ? 'var(--violet)' : f.status === 'claimed' ? 'var(--rose)' : 'var(--ink-3)',
          }}
        />
        {f.name}
      </div>
      <div className="kcard-summary">{f.summary}</div>
      <div className="kcard-chips">
        {f.chips.map((c) => (
          <span key={c} className="chip">
            {c}
          </span>
        ))}
      </div>
    </div>
  )
}

const COLUMNS: { status: Feature['status']; title: string }[] = [
  { status: 'shipped', title: 'Shipped' },
  { status: 'progress', title: 'In Progress' },
  { status: 'claimed', title: 'Claimed-only' },
]

function Kanban() {
  const s = useEngineTick()
  const refMap = useRef(new Map<string, HTMLDivElement>())
  const prevRects = useRef(new Map<string, DOMRect>())
  const prevSig = useRef('')

  const sig = s.features.map((f) => f.id + f.status).join('|')
  useLayoutEffect(() => {
    if (sig === prevSig.current) return
    prevSig.current = sig
    const next = new Map<string, DOMRect>()
    refMap.current.forEach((el, id) => next.set(id, el.getBoundingClientRect()))
    next.forEach((rect, id) => {
      const prev = prevRects.current.get(id)
      if (!prev) return
      const dx = prev.left - rect.left
      const dy = prev.top - rect.top
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return
      const el = refMap.current.get(id)!
      el.style.transition = 'none'
      el.style.transform = `translate(${dx}px, ${dy}px)`
      requestAnimationFrame(() => {
        el.style.transition = 'transform 250ms ease-out'
        el.style.transform = ''
      })
    })
    prevRects.current = next
  })

  return (
    <div className="kanban">
      {COLUMNS.map((col) => {
        const items = s.features.filter((f) => f.status === col.status)
        const sorted =
          col.status === 'shipped' ? [...items].sort((a, b) => (b.shippedAt ?? 0) - (a.shippedAt ?? 0)) : items
        return (
          <div className="kcol" key={col.status}>
            <div className="kcol-head">
              {col.title} <span className="num">{items.length}</span>
            </div>
            <div className="kcol-cards">
              {sorted.map((f) => (
                <Card key={f.id} f={f} refMap={refMap.current} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FeatureCol() {
  const s = useEngineTick()
  const queued = new Set(s.marketingQueue.filter((q) => q.status === 'queued').map((q) => q.id))
  return (
    <div className="kcol">
      <div className="kcol-head">
        Committed features <span className="num">{s.github.features.length}</span>
      </div>
      <div className="kcol-cards">
        {s.github.features.length === 0 && <div className="gh-empty">No feat: commits or merged PRs yet</div>}
        {s.github.features.map((f) => (
          <div className="kcard" key={f.id}>
            <div className="kcard-name">
              <i className="kdot" style={{ background: queued.has(f.id) ? 'var(--violet)' : 'var(--ink-3)' }} />
              {f.name}
            </div>
            <div className="kcard-summary">{f.summary}</div>
            <div className="kcard-chips">
              {f.chips.map((c) => (
                <span key={c} className="chip">
                  {c}
                </span>
              ))}
              {queued.has(f.id) && <span className="chip">queued for marketing</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PrCol({ prs }: { prs: GithubPr[] }) {
  const s = useEngineTick()
  return (
    <div className="kcol">
      <div className="kcol-head">
        Pull requests <span className="num">{prs.length}</span>
      </div>
      <div className="kcol-cards">
        {prs.length === 0 && <div className="gh-empty">No pull requests on this repo</div>}
        {prs.map((p) => {
          const job = [...s.shipJobs].reverse().find((j) => j.pr?.number === p.number)
          return (
            <a className="kcard gh-link" key={p.number} href={p.url} target="_blank" rel="noreferrer">
              <div className="kcard-name">
                <i
                  className="kdot"
                  style={{ background: p.merged ? 'var(--violet)' : p.state === 'open' ? 'var(--teal)' : 'var(--ink-3)' }}
                />
                #{p.number} {p.title}
              </div>
              <div className="kcard-summary">
                {p.author} · {p.merged ? 'merged' : p.state}
                {job ? (
                  <>
                    {' · '}
                    <TeracVerifyMark job={job} />
                  </>
                ) : null}
              </div>
            </a>
          )
        })}
      </div>
    </div>
  )
}

function CommitCol({ commits }: { commits: GithubCommit[] }) {
  return (
    <div className="kcol">
      <div className="kcol-head">
        Commits <span className="num">{commits.length}</span>
      </div>
      <div className="kcol-cards">
        {commits.length === 0 && <div className="gh-empty">No commits visible</div>}
        {commits.map((c) => (
          <a className="kcard gh-link" key={c.sha} href={c.url} target="_blank" rel="noreferrer">
            <div className="kcard-name">
              <span className="gh-sha num">{c.sha.slice(0, 7)}</span>
              {subject(c.message)}
            </div>
            <div className="kcard-summary">
              {c.author}
              {c.pr != null ? ` · #${c.pr}` : ''}
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

function GithubBoard() {
  const s = useEngineTick()
  return (
    <div className="kanban">
      <FeatureCol />
      <PrCol prs={s.github.prs} />
      <CommitCol commits={s.github.commits} />
    </div>
  )
}

function MicroSpark({ data }: { data: number[] }) {
  const w = 56
  const h = 14
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = Math.max(max - min, 1)
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 2 - ((v - min) / span) * (h - 4)}`).join(' ')
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke="#9b9b9b" strokeWidth={1} />
    </svg>
  )
}

function HealthStrip() {
  const s = useEngineTick()
  const now = useNow(1000)
  const series = s.repo.commits.length ? s.repo.commits : [0]
  const avg = (series.reduce((a, b) => a + b, 0) / series.length).toFixed(1)
  return (
    <div className="health-strip mono">
      <span className="hstat">
        commits/day <b className="num">{avg}</b> <MicroSpark data={series} />
      </span>
      <span className="hstat">
        open PRs <b className="num">{s.repo.openPRs}</b>
      </span>
      <span className="hstat">
        last scan <b className="num">{ago(s.repo.lastScanAt, now)}</b>
      </span>
    </div>
  )
}

const CHECK_LABEL: Record<BugCheck['status'], string> = {
  deploying: 'deploying…',
  reproducing: 'reproducing…',
  checking: 'checking code…',
  done: 'done',
}

function CompetitionShipStrip() {
  const s = useEngineTick()
  const job = [...s.shipJobs].reverse().find((j) => j.pr || j.stage === 'researching' || j.stage === 'briefed' || j.stage === 'building')
  if (!job) return null
  return (
    <div className="bug-strip-wrap">
      <div className="kcol-head" style={{ margin: '0 0 8px' }}>
        Shipping to GitHub {job.pr ? <span className="num">PR #{job.pr.number}</span> : null}
        <span className="bug-src"> · {job.feature} · {job.stage.replace(/-/g, ' ')}</span>
      </div>
      <div className="bug-strip">
        <div className={'bug-card' + (job.stage === 'shipped' ? ' confirmed' : '')}>
          <div className="bug-head">
            <span className="bug-agent">Repo Agent</span>
            <span className="bug-when num">{job.pr?.branch ?? job.file}</span>
          </div>
          <div className="bug-text">{job.pr?.title ?? job.brief}</div>
          <div className="bug-verdict">
            {job.stage === 'shipped' ? (
              <span className="v-confirmed">merged on main</span>
            ) : job.stage === 'rejected' ? (
              <span className="v-notrepro">rejected</span>
            ) : job.stage === 'blocked' ? (
              <span className="v-notrepro">{job.gate.reason ?? 'blocked'}</span>
            ) : job.stage === 'building' ? (
              <span className="dim">revising {job.file}…</span>
            ) : job.stage === 'pr-open' && job.pr?.merged ? (
              <span className="dim">merged — marking shipped…</span>
            ) : job.stage === 'pr-open' ? (
              <span className="dim">PR open</span>
            ) : (
              <span className="dim">{job.stage.replace(/-/g, ' ')}</span>
            )}
            <TeracVerifyMark job={job} />
            <span className="chip">{job.pr?.file ?? job.file}</span>
            {job.pr && <span className="chip num">{job.pr.sha}</span>}
            {job.pr?.url && (
              <a className="chip" href={job.pr.url} target="_blank" rel="noreferrer">
                github
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function BugStrip() {
  const s = useEngineTick()
  const now = useNow(5000)
  if (s.bugChecks.length === 0) return null
  return (
    <div className="bug-strip-wrap">
      <div className="kcol-head" style={{ margin: '0 0 8px' }}>
        Bug reports <span className="num">{s.bugChecks.length}</span>
        <span className="bug-src"> · from support, checked by a random engineer agent</span>
      </div>
      <div className="bug-strip">
        {s.bugChecks.map((b) => (
          <div className={'bug-card' + (b.verdict === 'confirmed' ? ' confirmed' : '')} key={b.id}>
            <div className="bug-head">
              <span className="fcast-mono sm">{b.agent.mono}</span>
              <span className="bug-agent">
                {b.agent.name}
                <span className="vote-persona">
                  {' '}
                  · {b.agent.provider} · {b.agent.model}
                </span>
              </span>
              <span className="bug-when num">{ago(b.at, now)}</span>
            </div>
            <div className="bug-text">
              <span className="dim">{b.customer}:</span> {b.text}
            </div>
            <div className="bug-verdict">
              {b.status !== 'done' ? (
                <span className="dim">{CHECK_LABEL[b.status]}</span>
              ) : b.verdict === 'confirmed' ? (
                <>
                  <span className="v-confirmed">confirmed</span> <span className="bug-finding">{b.finding}</span>
                  {b.chips.map((c) => (
                    <span key={c} className="chip">
                      {c}
                    </span>
                  ))}
                </>
              ) : (
                <>
                  <span className="v-notrepro">not reproduced</span> <span className="bug-finding dim">{b.finding}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Product() {
  const s = useEngineTick()
  return (
    <div className="product">
      <GithubBanner />
      <ShipBanner />
      {s.github.live ? <GithubBoard /> : <Kanban />}
      <CompetitionShipStrip />
      <BugStrip />
      <HealthStrip />
    </div>
  )
}
