import { useEffect, useState } from 'react'
import { ShipGate, ShipJob, ShipStage, teracVerifyLabel } from '../sim/engine'
import { useEngineTick } from '../App'

function ago(ts: number, now: number) {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ${m % 60}m ago`
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

const STATUS_LABEL: Record<string, string> = {
  watching: 'watching',
  scanning: 'scanning changelog…',
  reporting: 'reporting to CEO…',
}

const STAGE_LABEL: Record<ShipStage, string> = {
  researching: 'researching',
  briefed: 'brief forwarded',
  building: 'revising the product…',
  'pr-open': 'PR open on GitHub',
  'hiring-verify': 'hiring verifier…',
  'awaiting-verify': 'waiting on verify',
  rejected: 'PR rejected',
  shipped: 'shipped on main',
  blocked: 'blocked',
}

function CompetitorCards() {
  const s = useEngineTick()
  const now = useNow(1000)
  return (
    <div className="comp-cards">
      {s.competitors.map((c) => {
        const lastMove = [...s.intel].reverse().find((m) => m.comp === c.name)
        const hot = c.threat > 0.6
        return (
          <div className="comp-card" key={c.id}>
            <div className="comp-card-head">
              <span className="comp-name">{c.name}</span>
              <span className={'tracker-chip' + (c.status !== 'watching' ? ' busy' : '')}>
                <i />
                {STATUS_LABEL[c.status]}
              </span>
            </div>
            <div className="threat-row">
              <span className="threat-label">threat</span>
              <span className="threat-track">
                <span
                  className="threat-fill"
                  style={{ width: `${c.threat * 100}%`, background: hot ? 'var(--rose)' : 'var(--ink)' }}
                />
              </span>
              <span className="threat-val num" style={{ color: hot ? 'var(--rose)' : 'var(--ink-2)' }}>
                {(c.threat * 100).toFixed(0)}%
              </span>
            </div>
            <div className="comp-last">
              {lastMove ? (
                <>
                  <span className="dim">last move</span> {lastMove.text} <span className="dim num">· {ago(lastMove.at, now)}</span>
                </>
              ) : (
                <span className="dim">no moves detected yet</span>
              )}
            </div>
            <div className="comp-scan num">last scan {ago(c.lastScanAt, now)}</div>
          </div>
        )
      })}
    </div>
  )
}

function GateStrip({
  label,
  gate,
  waiting,
  doneYes,
  doneNo,
}: {
  label: string
  gate: ShipGate
  waiting: string
  doneYes: string
  doneNo: string
}) {
  if (gate.status === 'idle' && !gate.reason) return null
  const bad = gate.verdict === 'rejected' || gate.status === 'error' || gate.status === 'revised'
  return (
    <div className={'terac-strip' + (bad ? ' rev' : '')}>
      <span className="terac-kicker">Terac</span>
      <span>
        {gate.status === 'hiring' && `${label} · opening opportunity`}
        {gate.status === 'waiting' && (gate.reason ?? waiting)}
        {gate.status === 'error' && (gate.reason ?? 'Hire failed')}
        {gate.verdict === 'approved' && (
          <>
            <b>{gate.expert ?? 'Terac expert'}</b>
            {gate.quote != null ? ` · $${gate.quote}` : ''}
            {` — ${doneYes}`}
            {gate.reason ? ` · ${gate.reason}` : ''}
          </>
        )}
        {gate.verdict === 'rejected' && (
          <>
            <b>{gate.expert ?? 'Terac expert'}</b>
            {` — ${doneNo}`}
            {gate.reason ? ` · ${gate.reason}` : ''}
          </>
        )}
        {gate.status !== 'hiring' &&
          gate.status !== 'waiting' &&
          gate.status !== 'error' &&
          gate.verdict == null &&
          (gate.reason ?? label)}
      </span>
      {gate.dashboardUrl ? (
        <a className="terac-job num" href={gate.dashboardUrl} target="_blank" rel="noreferrer">
          {gate.jobId ?? 'dashboard'}
        </a>
      ) : (
        gate.jobId && <span className="terac-job num">{gate.jobId}</span>
      )}
    </div>
  )
}

function ShipPipeline() {
  const s = useEngineTick()
  const now = useNow(2000)
  const jobs = [...s.shipJobs].reverse()
  const active = jobs.find(
    (j) => j.stage !== 'rejected' && j.stage !== 'shipped' && j.stage !== 'blocked',
  )
  const job: ShipJob | undefined = active ?? jobs[0]
  return (
    <div className="panel-plain ship-pipe">
      <div className="ledger-head">
        <span>Research → product</span>
        <span className="dim-label">
          {s.teracMcp.live ? <span className="testmode live">TERAC MCP</span> : <span className="testmode off">TERAC MCP OFF</span>}
          {' · '}
          {job ? STAGE_LABEL[job.stage] : 'watching for a gap'}
        </span>
      </div>
      {!job && (
        <div className="ship-idle dim">
          Three intel agents scan rivals of Bob the Busines. Gaps forward to product. Repo Agent opens a PR on AliUraish/Buisness_Agent — Terac humans review, then merge.
        </div>
      )}
      {job && (
        <>
          <div className="research-row">
            {job.researchers.map((r) => (
              <div className={'research-chip' + (r.status === 'working' ? ' busy' : '')} key={r.agent}>
                <span className="fcast-mono sm">{r.mono}</span>
                <span className="research-name">{r.agent}</span>
                <span className="research-st">{r.status}</span>
                {r.note && <span className="research-note">{r.note}</span>}
              </div>
            ))}
          </div>
          <div className="ship-brief">
            <div className="ship-brief-k">
              {job.feature}
              <span className="dim">
                {' '}
                · {job.rival} · {ago(job.at, now)}
              </span>
            </div>
            <div className="ship-brief-t">{job.brief}</div>
          </div>
          {job.pr && (
            <div className="ship-pr">
              {job.pr.url ? (
                <a className="ship-pr-num num" href={job.pr.url} target="_blank" rel="noreferrer">
                  PR #{job.pr.number}
                </a>
              ) : (
                <span className="ship-pr-num num">PR #{job.pr.number}</span>
              )}
              <span className="ship-pr-title">{job.pr.title}</span>
              <span className="chip">{job.pr.branch}</span>
              <span className="chip">{job.pr.file}</span>
              <span className="chip num">{job.pr.sha}</span>
              {job.pr.merged && <span className="chip">merged</span>}
              {(() => {
                const v = teracVerifyLabel(job)
                if (v === 'verified') return <span className="v-confirmed">Terac verified</span>
                if (v === 'reviewing') return <span className="v-reviewing">Terac reviewing</span>
                if (v === 'not-verified') return <span className="v-notrepro">Terac not verified</span>
                return null
              })()}
            </div>
          )}
          {job.stage === 'blocked' && job.gate.reason && <div className="ship-brief-t">{job.gate.reason}</div>}
          {(job.gate.status !== 'idle' || job.gate.verdict) && (
            <GateStrip
              label={`Verify research → PR${job.pr ? ` #${job.pr.number}` : ''}`}
              gate={job.gate}
              waiting={job.pr ? `Waiting on a verified expert — does research → PR #${job.pr.number} hold up?` : 'Waiting on a verifier'}
              doneYes="research and PR hold up — ship it"
              doneNo="research or PR does not hold"
            />
          )}
        </>
      )}
    </div>
  )
}

function CapabilityMatrix() {
  const s = useEngineTick()
  const now = useNow(2000)
  return (
    <div className="panel-plain matrix-panel">
      <div className="ledger-head">
        <span>Capability matrix</span>
        <span className="dim-label">tracked by 3 intel agents</span>
      </div>
      <div className="matrix-scroll">
        <table className="matrix-table">
          <thead>
            <tr>
              <th>capability</th>
              <th className="c us">Bob the Busines</th>
              {s.competitors.map((c) => (
                <th className="c" key={c.id}>
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.capabilities.map((cap) => {
              const flashing = cap.flashAt != null && now - cap.flashAt < 12000
              return (
                <tr key={cap.id} className={flashing ? 'flash' : ''}>
                  <td>{cap.label}</td>
                  <td className="c">
                    {cap.ours ? <i className="cap-dot ours" /> : <span className="cap-none">—</span>}
                  </td>
                  {s.competitors.map((c) => (
                    <td className="c" key={c.id}>
                      {c.capIds.includes(cap.id) ? <span className="cap-yes">✓</span> : <span className="cap-none">—</span>}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function IntelFeed() {
  const s = useEngineTick()
  const now = useNow(5000)
  const rows = [...s.intel].reverse()
  return (
    <div className="panel-plain intel-panel">
      <div className="ledger-head">
        <span>Intel → product</span>
        <span className="dim-label num">{rows.length} moves</span>
      </div>
      <div className="intel-scroll">
        {rows.map((m) => (
          <div className="intel-row" key={m.id}>
            <span className="dim num t">{ago(m.at, now)}</span>
            <span className="intel-comp">{m.comp}</span>
            <span className="intel-text">{m.text}</span>
            {m.sources?.slice(0, 2).map((src) => (
              <span key={src} className="chip">{src}</span>
            ))}
            {m.counter ? (
              <span className="counter-chip">
                <svg width="18" height="8" viewBox="0 0 18 8">
                  <path d="M0 4 H13 M10 1 L14 4 L10 7" fill="none" stroke="#111" strokeWidth={1.1} />
                </svg>
                {m.counter}
              </span>
            ) : (
              <span className="dim" style={{ fontSize: 11 }}>
                analyzing…
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Competition() {
  return (
    <div className="competition">
      <CompetitorCards />
      <ShipPipeline />
      <div className="comp-lower">
        <CapabilityMatrix />
        <IntelFeed />
      </div>
    </div>
  )
}
