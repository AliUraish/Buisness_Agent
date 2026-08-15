import { useEffect, useState } from 'react'
import { AGENT_DEPT, DEPT_COLOR, Dept } from '../sim/engine'
import { useEngineTick } from '../App'

function clock(ts: number) {
  return new Date(ts).toTimeString().slice(0, 8)
}

function ago(ts: number, now: number) {
  const m = Math.max(0, Math.round((now - ts) / 60_000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

// with Stripe connected the table shows REAL payments (Stripe + Whop when
// live), newest first, with a running day total. Sim rows only when off.
function MoneyLedger() {
  const s = useEngineTick()
  const stripeLive = s.railsLive.stripe.live
  const today = s.stripeToday

  if (stripeLive) {
    const merged = [
      ...s.railsLive.stripe.recent.map((r) => ({ ...r, rail: 'Stripe' })),
      ...(s.railsLive.whop.live ? s.railsLive.whop.recent.map((r) => ({ ...r, rail: 'Whop' })) : []),
    ].sort((a, b) => a.created - b.created)
    let run = 0
    const withRun = merged.map((r) => {
      run += r.amount
      return { ...r, run }
    })
    const rows = [...withRun].reverse()
    return (
      <div className="ledger-panel">
        <div className="ledger-head">
          <span>Money ledger</span>
          <span className={'testmode' + (today?.mode === 'live' ? ' live' : '')}>
            STRIPE {today?.mode === 'live' ? 'LIVE' : 'TEST'}
          </span>
        </div>
        <div className="ledger-scroll">
          {rows.length === 0 ? (
            <div className="ledger-empty">
              No payments yet — revenue today ${((today?.grossCents ?? 0) / 100).toFixed(2)}. The first real charge
              lands here within a minute of payment.
            </div>
          ) : (
            <table className="ledger-table num">
              <thead>
                <tr>
                  <th>time</th>
                  <th>rail</th>
                  <th>description</th>
                  <th className="r">amount</th>
                  <th className="r">running</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono dim">{clock(r.created)}</td>
                    <td>
                      <span className="rail-mark">{r.rail[0]}</span>
                      {r.rail}
                    </td>
                    <td className="dim">{r.desc}</td>
                    <td className="r inflow">+${r.amount.toFixed(2)}</td>
                    <td className="r">${r.run.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {today?.live && (
          <div className="ledger-foot num">
            revenue today ${((today.grossCents ?? 0) / 100).toFixed(2)} · {today.count} payments · net $
            {((today.netCents ?? 0) / 100).toFixed(2)}
          </div>
        )}
      </div>
    )
  }

  const rows = [...s.transactions].reverse() // newest first
  return (
    <div className="ledger-panel">
      <div className="ledger-head">
        <span>Money ledger</span>
        <span className="testmode">SIM · TEST MODE</span>
      </div>
      <div className="ledger-scroll">
        <table className="ledger-table num">
          <thead>
            <tr>
              <th>time</th>
              <th>rail</th>
              <th>type</th>
              <th className="r">amount</th>
              <th className="r">balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="mono dim">{clock(t.at)}</td>
                <td>
                  <span className="rail-mark">{t.rail[0]}</span>
                  {t.rail}
                </td>
                <td className="dim">{t.plan} · subscription</td>
                <td className="r inflow">+${t.amount}</td>
                <td className="r">${t.balance.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SpendDonut({ byDept, total }: { byDept: Map<Dept, number>; total: number }) {
  const R = 30
  const C = 2 * Math.PI * R
  let offset = 0
  const segs = [...byDept.entries()].filter(([, v]) => v > 0)
  return (
    <svg width={80} height={80} viewBox="0 0 80 80">
      {segs.map(([dept, v]) => {
        const frac = v / total
        const seg = (
          <circle
            key={dept}
            cx={40}
            cy={40}
            r={R}
            fill="none"
            stroke={DEPT_COLOR[dept]}
            strokeWidth={9}
            strokeDasharray={`${frac * C} ${C}`}
            strokeDashoffset={-offset * C}
            transform="rotate(-90 40 40)"
          />
        )
        offset += frac
        return seg
      })}
    </svg>
  )
}

function LlmLedger() {
  const s = useEngineTick()
  const rows = [...s.llmCalls].reverse()
  const totalTokens = s.llmCalls.reduce((a, c) => a + c.tokens, 0)
  const totalCost = s.llmCalls.reduce((a, c) => a + c.cost, 0)

  const byDept = new Map<Dept, number>()
  for (const c of s.llmCalls) {
    const d = AGENT_DEPT[c.agent] ?? 'ceo'
    byDept.set(d, (byDept.get(d) ?? 0) + c.cost)
  }

  return (
    <div className="ledger-panel">
      <div className="ledger-head">
        <span>LLM ledger</span>
        <span className="dim-label num">{s.llmCalls.length} calls</span>
      </div>
      <div className="ledger-scroll">
        <table className="ledger-table num">
          <thead>
            <tr>
              <th>agent</th>
              <th>provider</th>
              <th>model</th>
              <th className="r">tokens</th>
              <th className="r">cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <i className="dept-dot" style={{ background: DEPT_COLOR[AGENT_DEPT[c.agent] ?? 'ceo'] }} />
                  {c.agent}
                </td>
                <td className="dim">{c.provider}</td>
                <td className="mono dim">{c.model}</td>
                <td className="r dim">{c.tokens.toLocaleString()}</td>
                <td className="r mono">${c.cost.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>total</td>
              <td className="r">{totalTokens.toLocaleString()}</td>
              <td className="r mono">${totalCost.toFixed(4)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="kicker-row">
        <div className="kicker">
          This company cost <span className="num">${s.spendToday.toFixed(2)}</span> to operate today.
        </div>
        <div className="donut-wrap">
          <SpendDonut byDept={byDept} total={totalCost} />
          <div className="donut-labels">
            {[...byDept.entries()]
              .filter(([, v]) => v > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([dept, v]) => (
                <span key={dept} className="num">
                  <i style={{ background: DEPT_COLOR[dept] }} />
                  {dept} ${v.toFixed(2)}
                </span>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function PostLedger() {
  const s = useEngineTick()
  const now = useNow(30_000)
  const posts = [...s.posts].reverse()
  if (posts.length === 0) return null
  const maxBar = Math.max(...posts.map((p) => Math.max(p.predicted, p.actual ?? 0)), 1)
  return (
    <div className="post-strip">
      {posts.map((p) => {
        const hit = p.actual != null && p.actual >= p.predicted
        return (
          <div className="post-card" key={p.id}>
            <div className="post-top">
              <span className="post-avatar">Z</span>
              <span className="post-who">
                Bob the Busines <span className="dim">@business_agent · {ago(p.at, now)}</span>
              </span>
              {p.actual == null ? (
                <span className="post-verdict dim num">measuring…</span>
              ) : hit ? (
                <svg className="post-verdict" width={12} height={12} viewBox="0 0 12 12">
                  <path d="M2.5 6.5 L5 9 L9.5 3.5" fill="none" stroke="#3fa55c" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span className="post-verdict dim">—</span>
              )}
            </div>
            <div className="post-text">{p.text}</div>
            <div className="post-bars num">
              <div className="post-bar-row">
                <span className="post-bar pred" style={{ width: `${(p.predicted / maxBar) * 100}%` }} />
                <span className="post-bar-val">pred {p.predicted}</span>
              </div>
              <div className="post-bar-row">
                <span className="post-bar act" style={{ width: `${((p.actual ?? 0) / maxBar) * 100}%` }} />
                <span className="post-bar-val">act {p.actual ?? '·'}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function Ledger() {
  return (
    <div className="ledgermode">
      <div className="ledger-cols">
        <MoneyLedger />
        <LlmLedger />
      </div>
      <PostLedger />
    </div>
  )
}
