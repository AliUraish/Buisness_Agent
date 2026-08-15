import { useEffect, useMemo, useRef, useState } from 'react'
import { engine, BOOT_MRR, LIVE_ONLY } from '../sim/engine'
import { useEngineTick } from '../App'
import { buildHistory, PAST_CAMPAIGNS } from '../data/finance'

function fmtK(v: number) {
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`
}

function fmtClock(ts: number) {
  return new Date(ts).toTimeString().slice(0, 8)
}

interface MarkHover {
  x: number
  y: number
  label: string
  detail: string
}

function ForecastChart() {
  const s = useEngineTick()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<MarkHover | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const history = useMemo(() => buildHistory(BOOT_MRR), [])

  const { w, h } = size
  if (w === 0) return <div className="fin-chart-canvas" ref={wrapRef} />

  const padL = 46
  const padR = 16
  const padT = 18
  const padB = 30

  // forecast series from the live ensemble
  const p50End = engine.forecastP50()
  const preds = s.forecasters.map((f) => f.p50)
  const spread = preds.length ? Math.max(...preds) - Math.min(...preds) : p50End * 0.12
  const bandEnd = Math.max(spread * 0.65, p50End * 0.055)
  // in live-only mode the top bar tracks real revenue; the chart keeps the
  // original modelled-MRR view so history and forecast join cleanly
  const mrrNow = LIVE_ONLY ? BOOT_MRR : s.mrr

  const STEPS = 30
  const p50Series: number[] = []
  const p10Series: number[] = []
  const p90Series: number[] = []
  for (let t = 0; t <= STEPS; t++) {
    const g = Math.pow(t / STEPS, 0.95)
    const half = bandEnd * Math.pow(t / STEPS, 0.7)
    const mid = mrrNow + (p50End - mrrNow) * g
    p50Series.push(mid)
    p10Series.push(mid - half)
    p90Series.push(mid + half)
  }

  const yMin = Math.min(history[0], ...p10Series) * 0.985
  const yMax = Math.max(...p90Series, mrrNow) * 1.015
  const X = (t: number) => padL + ((t + 30) / 60) * (w - padL - padR)
  const Y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * (h - padT - padB)
  const axisY = h - padB

  // actual: history at days −30…−1, then live MRR at t=0
  const actualPts = history
    .slice(0, 30)
    .map((v, i) => `${X(i - 30)},${Y(v)}`)
    .concat(`${X(0)},${Y(mrrNow)}`)
    .join(' ')

  const fanPts = p90Series
    .map((v, t) => `${X(t)},${Y(v)}`)
    .concat([...p10Series].reverse().map((v, i) => `${X(STEPS - i)},${Y(v)}`))
    .join(' ')
  const medianPts = p50Series.map((v, t) => `${X(t)},${Y(v)}`).join(' ')

  // y grid: 4 dotted lines
  const gridLines = Array.from({ length: 4 }, (_, i) => yMin + ((i + 1) / 5) * (yMax - yMin))

  // markers: past campaigns + any launched this session (at NOW)
  const markers = [
    ...PAST_CAMPAIGNS.map((c) => ({
      t: -c.day,
      label: c.label,
      detail: `+$${c.bump} MRR in ${c.bumpDays * 24}h`,
      bumpT: -c.day + c.bumpDays,
    })),
    ...s.sessionCampaigns.slice(-1).map((c) => ({
      t: 0,
      label: c.label,
      detail: 'just launched — watching for the bump',
      bumpT: null as number | null,
    })),
  ]

  return (
    <div className="fin-chart-canvas" ref={wrapRef}>
      <svg width={w} height={h}>
        {/* dotted y-grid, no x-gridlines */}
        {gridLines.map((v) => (
          <g key={v}>
            <line x1={padL} x2={w - padR} y1={Y(v)} y2={Y(v)} stroke="rgba(0,0,0,0.05)" strokeWidth={1} strokeDasharray="2 4" />
            <text x={padL - 8} y={Y(v) + 3} textAnchor="end" fontSize={10} fill="var(--ink-3)" className="mono">
              {fmtK(v)}
            </text>
          </g>
        ))}

        {/* axis line */}
        <line x1={padL} x2={w - padR} y1={axisY} y2={axisY} stroke="rgba(0,0,0,0.10)" strokeWidth={1} />
        {[-30, -15, 15, 30].map((t) => (
          <text key={t} x={X(t)} y={axisY + 16} textAnchor="middle" fontSize={10} fill="var(--ink-3)" className="mono">
            {t < 0 ? `${t}d` : `+${t}d`}
          </text>
        ))}

        {/* P10–P90 fan: one flat tone, not a gradient */}
        <polygon points={fanPts} fill="rgba(232,163,61,0.08)" stroke="none" />
        <polyline points={medianPts} fill="none" stroke="var(--amber)" strokeWidth={1.5} strokeDasharray="5 4" />

        {/* NOW hairline */}
        <line x1={X(0)} x2={X(0)} y1={padT} y2={axisY} stroke="rgba(0,0,0,0.15)" strokeWidth={1} />
        <text x={X(0)} y={padT - 5} textAnchor="middle" fontSize={9} fill="var(--ink-3)" className="mono" letterSpacing="0.08em">
          NOW
        </text>

        {/* actual revenue */}
        <polyline points={actualPts} fill="none" stroke="#111" strokeWidth={2} strokeLinejoin="round" />

        {/* cause→effect underlines: marker → bump */}
        {markers.map(
          (m) =>
            m.bumpT != null && (
              <line
                key={'u' + m.label}
                x1={X(m.t)}
                x2={X(m.bumpT)}
                y1={axisY - 4}
                y2={axisY - 4}
                stroke="var(--teal)"
                strokeWidth={1.5}
                opacity={0.55}
              />
            ),
        )}

        {/* campaign markers on the x-axis */}
        {markers.map((m) => (
          <g key={m.label}>
            <path
              d={`M ${X(m.t) - 5} ${axisY + 8} L ${X(m.t) + 5} ${axisY + 8} L ${X(m.t)} ${axisY + 1} Z`}
              fill="var(--teal)"
            />
            <rect
              x={X(m.t) - 10}
              y={axisY - 6}
              width={20}
              height={20}
              fill="transparent"
              style={{ cursor: 'default' }}
              onMouseEnter={() => setHover({ x: X(m.t), y: axisY - 10, label: m.label, detail: m.detail })}
              onMouseLeave={() => setHover(null)}
            />
          </g>
        ))}
      </svg>

      {hover && (
        <div className="mark-tip" style={{ left: hover.x, top: hover.y }}>
          <div className="mark-tip-label">{hover.label}</div>
          <div className="mark-tip-detail num">{hover.detail}</div>
        </div>
      )}
    </div>
  )
}

function ForecasterRow() {
  const s = useEngineTick()
  const fs = s.forecasters
  if (fs.length === 0) return null
  const preds = fs.map((f) => f.p50)
  const lo = Math.min(...preds)
  const hi = Math.max(...preds)
  const mean = preds.reduce((a, b) => a + b, 0) / preds.length
  const split = (hi - lo) / mean > 0.14
  const span = Math.max(hi - lo, 1)

  return (
    <div className="fin-forecasters">
      <div className={'gauge' + (split ? ' split' : '')}>
        <div className="gauge-track">
          {fs.map((f) => (
            <i key={f.model} style={{ left: `${6 + ((f.p50 - lo) / span) * 88}%` }} title={`${f.model} $${f.p50.toLocaleString()}`} />
          ))}
        </div>
        <span className="gauge-label num">
          {split ? 'Forecasters split' : `spread $${(hi - lo).toLocaleString()}`}
        </span>
      </div>
      <div className="fcast-row">
        {fs.map((f) => (
          <div className="fcast-card" key={f.model}>
            <div className="fcast-head">
              <span className="fcast-mono">{f.mono}</span>
              <span>
                {f.model} <span className="fcast-persona">· {f.persona}</span>
              </span>
            </div>
            <div className="fcast-pred num">${f.p50.toLocaleString()}</div>
            <div className="fcast-conf">
              <div className="fcast-conf-fill" style={{ width: `${f.confidence * 100}%` }} />
            </div>
            <div className="fcast-why">{f.rationale}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Aggregation() {
  const s = useEngineTick()
  const fs = s.forecasters
  if (fs.length === 0) return null
  const wsum = fs.reduce((a, f) => a + f.confidence, 0)
  const final = engine.forecastP50()
  return (
    <div className="agg mono">
      <div className="agg-head">confidence-weighted merge</div>
      {fs.map((f) => (
        <div className="agg-line" key={f.model}>
          <span>
            {(f.confidence / wsum).toFixed(2)} × ${f.p50.toLocaleString()}
          </span>
          <span className="agg-who">
            {f.model} · {f.persona}
          </span>
        </div>
      ))}
      <div className="agg-total">
        <span>= ${final.toLocaleString()}</span>
        <span className="agg-who">30d P50</span>
      </div>
    </div>
  )
}

function Report() {
  const s = useEngineTick()
  const note = s.forecastNote
  if (!note.text) return null
  return (
    <div className="report">
      <div className="report-head">
        <span>Forecast report</span>
        <span className="num" style={{ color: 'var(--ink-3)' }}>{fmtClock(note.at)}</span>
      </div>
      <p className="report-body">{note.text}</p>
      {note.scheduled && (
        <div className="report-action">
          <svg width="26" height="10" viewBox="0 0 26 10">
            <path d="M0 5 H20 M16 1.5 L21 5 L16 8.5" fill="none" stroke="#111" strokeWidth={1.2} />
          </svg>
          <span className="chip">CEO scheduled campaign #{note.scheduled}</span>
        </div>
      )}
      <div className="rails num">
        {(['Stripe'] as const).map((rail) => {
          const liveInfo = s.railsLive.stripe
          return (
            <span className="rail-chip" key={rail}>
              <i className="rail-mono">{rail[0]}</i>
              {rail}{' '}
              {liveInfo.live ? (
                <>
                  <b>${(liveInfo.total ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</b>
                  <span className="rail-live">{rail === 'Stripe' ? 'test · live' : 'live'} · {liveInfo.count} pays</span>
                </>
              ) : (
                <>
                  <b>${(s.railTotals[rail] ?? 0).toLocaleString()}</b>
                  <span className="rail-sim">sim</span>
                </>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// Revenue earned today from the real Stripe account — the prize metric.
// Big, honest, and labeled with the exact mode it came from.
function RevenueToday() {
  const s = useEngineTick()
  const r = s.stripeToday
  return (
    <div className="panel-plain revtoday">
      <div className="revtoday-main">
        <div>
          <div className="mrr-label">
            Revenue today
            {r?.live ? (
              <span className={'testmode ' + (r.mode === 'live' ? 'live' : '')} style={{ marginLeft: 8 }}>
                STRIPE {r.mode === 'live' ? 'LIVE' : 'TEST'}
              </span>
            ) : (
              <span className="testmode off" style={{ marginLeft: 8 }}>
                STRIPE OFF
              </span>
            )}
          </div>
          <div className="revtoday-amount num">
            {r?.live ? `$${(r.grossCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
          </div>
        </div>
        {r?.live ? (
          <div className="treasury-stats num">
            <div className="tstat">
              <span className="k">payments</span>
              <span className="v">{r.count}</span>
            </div>
            <div className="tstat">
              <span className="k">refunds</span>
              <span className="v">${(r.refundCents / 100).toFixed(2)}</span>
            </div>
            <div className="tstat">
              <span className="k">fees</span>
              <span className="v">${(r.feeCents / 100).toFixed(2)}</span>
            </div>
            <div className="tstat">
              <span className="k">net</span>
              <span className="v" style={{ color: r.netCents >= 0 ? 'var(--green)' : 'var(--red)' }}>
                ${(r.netCents / 100).toFixed(2)}
              </span>
            </div>
          </div>
        ) : (
          <div className="revtoday-note dim-label">{r?.note ?? 'connecting to backend…'}</div>
        )}
      </div>
      {r?.live && <div className="revtoday-sub num">since local midnight · polled every 60s · read-only</div>}
    </div>
  )
}

// where the company's real costs draw from: Perflo until the limit,
// then overflow to Stripe — both pools shown honestly
function FundingMeter() {
  const s = useEngineTick()
  const f = s.funding
  const pct = f.perfloLimit > 0 ? Math.min((f.perfloSpent / f.perfloLimit) * 100, 100) : 0
  return (
    <div className="funding num">
      {!s.bank.live && (
        <div className="funding-row">
          <span className="funding-label">Perflo not connected — costs → Stripe</span>
          <b>${f.stripeSpent.toFixed(2)}</b>
        </div>
      )}
      {s.bank.live && (
      <div className="funding-row">
        <span className="funding-label">costs → Perflo</span>
        <span className="conf-track" style={{ flex: 1 }}>
          <i style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--rose)' : 'var(--ink)' }} />
        </span>
        <b>${f.perfloSpent.toFixed(2)}</b>
        <span className="dim-label">of ${f.perfloLimit.toFixed(2)} limit</span>
      </div>
      )}
      {(f.source === 'stripe' || f.stripeSpent > 0) && (
        <div className="funding-row overflow">
          <span className="funding-label" style={{ color: 'var(--rose)' }}>limit full → Stripe</span>
          <b>${f.stripeSpent.toFixed(2)}</b>
        </div>
      )}
    </div>
  )
}

const BANK_COLORS = ['#111111', '#9b9b9b', '#2ab3a6', '#7c6ff0', '#e8a33d', '#e05c8a', '#3fa55c']

// "Bob the Banker" — the operating account, allocation owned by the CFO Agent
function BankPanel() {
  const s = useEngineTick()
  const bank = s.bank
  return (
    <div className="panel-plain bankpanel">
      <div className="ledger-head">
        <span>
          {bank.name}{' '}
          {bank.live ? <span className="testmode live">PERFLO LIVE</span> : <span className="testmode">PERFLO OFF · SIM</span>}
        </span>
        <span className="dim-label">managed by CFO Agent</span>
      </div>
      <div className="bank-body">
        <div className="bank-balance num">{bank.live ? `$${bank.balance.toLocaleString()}` : '—'}</div>
        {!bank.live && <div className="dim-label" style={{ marginBottom: 8 }}>waiting for a live Perflo read — no simulated balance</div>}
        <div className="alloc-bar">
          {bank.alloc.map((a, i) => (
            <span key={a.label} className="alloc-seg" style={{ width: `${a.pct}%`, background: BANK_COLORS[i % BANK_COLORS.length] }} />
          ))}
        </div>
        <div className="bank-rows num">
          {bank.alloc.map((a, i) => (
            <div className="bank-row" key={a.label}>
              <i style={{ background: BANK_COLORS[i % BANK_COLORS.length] }} />
              <span className="bank-label">{a.label}</span>
              <b>{a.pct}%</b>
              <span className="bank-amt">{bank.live ? `$${Math.round((bank.balance * a.pct) / 100).toLocaleString()}` : '—'}</span>
            </div>
          ))}
        </div>
        {bank.note && <div className="bank-note">CFO: {bank.note}</div>}
        <FundingMeter />
        <div className="bank-review num">
          {!bank.review && <span className="dim-label">—</span>}
          {bank.review?.status === 'proposing' && <span className="dim-label">CFO Agent dividing the account…</span>}
          {bank.review?.status === 'waiting' && (
            <>
              <span className="testmode live">TERAC</span> <span className="dim-label">human reviewing the division…</span>
            </>
          )}
          {bank.review?.status === 'approved' && (
            <>
              <span className="testmode live">HUMAN ✓</span>{' '}
              <span className="dim-label">{bank.review.expert ?? 'Terac expert'} approved — {bank.review.note}</span>
            </>
          )}
          {bank.review?.status === 'adjust' && (
            <>
              <span className="testmode off">HUMAN ⚑</span> <span className="dim-label">{bank.review.note}</span>
            </>
          )}
          {bank.review?.status === 'skipped' && (
            <span className="dim-label">human review skipped — {bank.review.note}</span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Finance() {
  return (
    <div className="finance">
      <RevenueToday />
      <div className="fin-chart">
        <ForecastChart />
      </div>
      <ForecasterRow />
      <div className="fin-bottom three">
        <Aggregation />
        <Report />
        <BankPanel />
      </div>
    </div>
  )
}
