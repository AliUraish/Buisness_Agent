import { useEffect, useState } from 'react'
import { Asset, MarketRound, TradeGate, engine } from '../sim/engine'
import { useEngineTick } from '../App'

function clock(ts: number) {
  return new Date(ts).toTimeString().slice(0, 5)
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

function fmtPrice(p: number) {
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (p >= 10) return p.toFixed(2)
  return p.toFixed(4)
}

const ALLOC_COLOR: Record<string, string> = {
  Yield: 'var(--amber)',
  'Ops buffer': 'var(--ink)',
  Growth: 'var(--teal)',
  Reserve: 'var(--ink-3)',
  Crypto: 'var(--violet)',
}

function TreasuryPanel() {
  const s = useEngineTick()
  const t = s.treasury
  const total = t.alloc.reduce((a, x) => a + x.amount, 0)
  const net = s.mrr - t.burnMo
  const feedLabel =
    s.marketFeed === 'live'
      ? s.ordersLive
        ? 'Alpaca · live · paper orders'
        : 'Alpaca · live data · sim fills'
      : s.marketFeed === 'connecting'
        ? 'Alpaca · connecting…'
        : 'Alpaca · sim fallback'
  return (
    <div className="panel-plain treasury">
      <div className="treasury-main">
        <div>
          <div className="mrr-label">
            Treasury <span className="alpaca-chip">{feedLabel}</span>
            {s.paperEquity != null && <span className="alpaca-chip">paper equity ${s.paperEquity.toFixed(0)}</span>}
          </div>
          <div className="treasury-cash num">${t.cash.toLocaleString()}</div>
        </div>
        <div className="treasury-stats num">
          <div className="tstat">
            <span className="k">burn / mo</span>
            <span className="v">${t.burnMo.toLocaleString()}</span>
          </div>
          <div className="tstat">
            <span className="k">revenue</span>
            <span className="v" style={{ color: 'var(--green)' }}>${s.mrr.toLocaleString()}</span>
          </div>
          <div className="tstat">
            <span className="k">desk P&L</span>
            <span className="v" style={{ color: s.tradingRevenue >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {s.tradingRevenue >= 0 ? '+' : ''}${s.tradingRevenue.toFixed(0)}
            </span>
          </div>
          <div className="tstat">
            <span className="k">net</span>
            <span className="v" style={{ color: net >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {net >= 0 ? '+' : ''}${net.toLocaleString()}
            </span>
          </div>
          <div className="tstat">
            <span className="k">runway</span>
            <span className="v">{net >= 0 ? 'default alive' : `${Math.floor(t.cash / (t.burnMo - s.mrr))}mo`}</span>
          </div>
        </div>
      </div>
      <div className="alloc-bar">
        {t.alloc.map((a) => (
          <span key={a.label} className="alloc-seg" style={{ width: `${(a.amount / total) * 100}%`, background: ALLOC_COLOR[a.label] ?? 'var(--ink-3)' }} />
        ))}
      </div>
      <div className="alloc-labels num">
        {t.alloc.map((a) => (
          <span key={a.label}>
            <i style={{ background: ALLOC_COLOR[a.label] ?? 'var(--ink-3)' }} />
            {a.label} <b>${a.amount.toLocaleString()}</b>
          </span>
        ))}
      </div>
    </div>
  )
}

function PriceChart({ a }: { a: Asset }) {
  const w = 232
  const h = 54
  const min = Math.min(...a.history)
  const max = Math.max(...a.history)
  const span = Math.max(max - min, max * 1e-6)
  const pts = a.history.map((v, i) => `${(i / (a.history.length - 1)) * w},${h - 2 - ((v - min) / span) * (h - 4)}`).join(' ')
  const last = pts.split(' ').pop()!.split(',').map(Number)
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke="#111" strokeWidth={1.2} />
      <circle cx={last[0]} cy={last[1]} r={2} fill="#111" />
    </svg>
  )
}

function MarketsRow() {
  const s = useEngineTick()
  const current = s.marketRounds[0]
  return (
    <div className="markets-row">
      {s.assets.map((a) => {
        const up = a.changePct >= 0
        const isWinner = current?.winner === a.id
        return (
          <div className={'market-card' + (isWinner ? ' picked' : '')} key={a.id}>
            <div className="market-head">
              <span className="market-sym">{a.symbol}</span>
              <span className="market-name">{a.name}</span>
              {isWinner && <span className="pick-chip">#1 pick</span>}
            </div>
            <div className="market-price num">
              ${fmtPrice(a.price)}
              <span className="market-chg" style={{ color: up ? 'var(--green)' : 'var(--red)' }}>
                {up ? '+' : ''}{a.changePct.toFixed(2)}%
              </span>
            </div>
            <PriceChart a={a} />
          </div>
        )
      })}
    </div>
  )
}

function roiCell(v: number | undefined) {
  if (v == null) return <span className="dim">…</span>
  return (
    <span style={{ color: v >= 0 ? 'var(--green)' : 'var(--red)' }}>
      {v >= 0 ? '+' : ''}{v.toFixed(1)}%
    </span>
  )
}

function DeskPanel() {
  const s = useEngineTick()
  const round: MarketRound | undefined = s.marketRounds[0]
  if (!round) {
    return (
      <div className="panel-plain desk">
        <div className="ledger-head">
        <span>Prediction round · 30d ROI</span>
        <span className="dim-label">desk opening a paper round…</span>
        </div>
      </div>
    )
  }
  const done = round.preds.filter((p) => p.roi != null).length
  const bySym = (id: string) => s.assets.find((a) => a.id === id)!
  return (
    <div className="panel-plain desk">
      <div className="ledger-head">
        <span>Prediction round · 30d ROI</span>
        <span className="dim-label num">
          {round.status === 'predicting'
            ? `${done}/5 agents in`
            : round.terac.status === 'waiting' || round.terac.status === 'hiring'
              ? 'ranked — waiting on Terac form'
              : round.status === 'ranked'
                ? 'ranked — deploying'
                : `executed · ${clock(round.at)}`}
        </span>
        <button className="start-pill" type="button" onClick={() => engine.tradeNow()}>
          Trade now
        </button>
      </div>
      <div className="desk-scroll">
        <table className="ledger-table num desk-table">
          <thead>
            <tr>
              <th>agent</th>
              {s.assets.map((a) => (
                <th className="r" key={a.id}>{a.symbol}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {round.preds.map((p) => (
              <tr key={p.agent}>
                <td>
                  <span className="fcast-mono sm">{p.mono}</span>
                  {p.agent} <span className="dim desk-persona">· {p.persona}</span>
                </td>
                {s.assets.map((a) => (
                  <td className="r" key={a.id}>
                    {p.roi == null ? <span className="dim">deliberating…</span> : roiCell(p.roi[a.id])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {round.consensus && (
            <tfoot>
              <tr>
                <td>consensus</td>
                {s.assets.map((a) => {
                  const c = round.consensus!.find((x) => x.assetId === a.id)!
                  return (
                    <td className="r" key={a.id}>
                      {roiCell(c.roi)}
                    </td>
                  )
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {round.consensus && (
        <div className="ranking-strip num">
          {round.consensus.map((c, i) => (
            <span className={'rank-chip' + (i === 0 ? ' top' : '')} key={c.assetId}>
              <b>{i + 1}</b> {bySym(c.assetId).symbol} {c.roi >= 0 ? '+' : ''}{c.roi.toFixed(1)}%
            </span>
          ))}
          <span className="rank-action">
            {round.status === 'executed' && round.orderId ? (
              <>
                → invested ${round.amount} in {bySym(round.winner!).symbol} @ ${fmtPrice(round.entryPrice!)}
                <span className="chip">{round.orderId}</span>
              </>
            ) : (
              <>
                → {round.terac.status === 'waiting' || round.terac.status === 'hiring'
                  ? `holding $${round.amount} ${bySym(round.winner!).symbol} until the Terac form is filled`
                  : `deploying $${round.amount} into ${bySym(round.winner!).symbol} — highest consensus ROI`}
              </>
            )}
          </span>
        </div>
      )}
      {round.terac.status !== 'idle' && <TradeGateStrip gate={round.terac} />}
    </div>
  )
}

// mirrors the audience Terac strip: hired human, stated confidence, receipts
function TradeGateStrip({ gate }: { gate: TradeGate }) {
  return (
    <div className="trade-gate">
      {gate.live ? <span className="testmode live">TERAC LIVE</span> : <span className="testmode off">TERAC OFF</span>}
      <span className="terac-kicker">Terac</span>
      {gate.status === 'hiring' && <span className="dim">opening the Terac form…</span>}
      {gate.status === 'waiting' && <span className="dim">holding the fill — waiting on the Terac form</span>}
      {gate.status === 'error' && <span className="dim">no form yet — {gate.note ?? 'holding the fill'}</span>}
      {(gate.status === 'expert' || gate.status === 'desk') && gate.confidence != null && (
        <>
          <span className="conf-track">
            <i style={{ width: `${gate.confidence}%`, background: gate.confidence >= 50 ? 'var(--ink)' : 'var(--rose)' }} />
          </span>
          <b className="conf-val num">{gate.confidence}%</b>
          <span className="conf-who">{gate.status === 'expert' ? (gate.expert ?? 'Terac expert') : 'desk consensus'}</span>
          {gate.note && <span className="conf-note dim">— {gate.note}</span>}
        </>
      )}
      {gate.quote != null && <span className="chip">${gate.quote}</span>}
      {gate.dashboardUrl ? (
        <a className="terac-job num" href={gate.dashboardUrl} target="_blank" rel="noreferrer">
          {gate.jobId?.slice(0, 12)} ↗
        </a>
      ) : (
        gate.jobId && <span className="terac-job num">{gate.jobId.slice(0, 12)}</span>
      )}
    </div>
  )
}

function PositionsPanel() {
  const s = useEngineTick()
  const rows = [...s.positions].reverse()
  const totalCost = s.positions.reduce((a, p) => a + p.cost, 0)
  const totalNow = s.positions.reduce((a, p) => {
    const asset = s.assets.find((x) => x.id === p.assetId)!
    return a + p.qty * asset.price
  }, 0)
  const totalPnl = totalNow - totalCost
  return (
    <div className="panel-plain history-panel">
      <div className="ledger-head">
        <span>Positions</span>
        <span className="dim-label num">
          ${totalNow.toFixed(0)} mkt · uP&L{' '}
          <b style={{ color: totalPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
          </b>
          {' · '}realized{' '}
          <b style={{ color: s.tradingRevenue >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {s.tradingRevenue >= 0 ? '+' : ''}${s.tradingRevenue.toFixed(2)}
          </b>
        </span>
      </div>
      <div className="history-scroll">
        <table className="ledger-table num">
          <thead>
            <tr>
              <th>time</th>
              <th>asset</th>
              <th className="r">qty</th>
              <th className="r">entry</th>
              <th className="r">cost</th>
              <th className="r">market</th>
              <th className="r">uP&L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const asset = s.assets.find((x) => x.id === p.assetId)!
              const mkt = p.qty * asset.price
              const pnl = mkt - p.cost
              const pnlPct = (pnl / p.cost) * 100
              return (
                <tr key={p.id}>
                  <td className="mono dim">{clock(p.at)}</td>
                  <td>
                    <b style={{ fontWeight: 500 }}>{asset.symbol}</b> <span className="dim">{asset.name}</span>
                  </td>
                  <td className="r mono dim">{p.qty.toFixed(p.qty > 100 ? 0 : 4)}</td>
                  <td className="r dim">${fmtPrice(p.entry)}</td>
                  <td className="r">${p.cost.toFixed(0)}</td>
                  <td className="r">${mkt.toFixed(2)}</td>
                  <td className="r" style={{ color: pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} · {pnl >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Investment() {
  useNow(10_000) // keep clocks fresh between engine emits
  return (
    <div className="investment">
      <TreasuryPanel />
      <MarketsRow />
      <DeskPanel />
      <PositionsPanel />
    </div>
  )
}
