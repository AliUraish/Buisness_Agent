import { useEffect, useState } from 'react'
import { engine, DEPT_COLOR } from './sim/engine'
import Overview from './modes/Overview'
import AudienceMap from './modes/AudienceMap'
import Product from './modes/Product'
import Finance from './modes/Finance'
import Ledger from './modes/Ledger'
import Competition from './modes/Competition'
import Investment from './modes/Investment'
import Support from './modes/Support'

const MODES = [
  { key: '1', name: 'Overview' },
  { key: '2', name: 'Audience' },
  { key: '3', name: 'Product' },
  { key: '4', name: 'Finance' },
  { key: '5', name: 'Ledger' },
  { key: '6', name: 'Competition' },
  { key: '7', name: 'Investment' },
  { key: '8', name: 'Support' },
]

// engine state is mutated in place, so version-tick to re-render
let tick = 0
export function useEngineTick() {
  const [, setV] = useState(0)
  useEffect(() => engine.subscribe(() => setV(++tick)), [])
  return engine.state
}

function TopBar({ mode, setMode }: { mode: number; setMode: (m: number) => void }) {
  const s = useEngineTick()
  return (
    <header className="topbar">
      <div className="wordmark">
        Business_Agent <span>/ Bob the Busines</span>
      </div>
      <nav className="tabs">
        {MODES.map((m, i) => (
          <button key={m.key} className={'tab' + (mode === i ? ' active' : '')} onClick={() => setMode(i)}>
            <span className="key num">{m.key}</span>
            {m.name}
          </button>
        ))}
      </nav>
      <div className="topstats">
        <div className="topstat">
          <span className="v money num">${s.mrr.toLocaleString()}</span>
          <span className="k">MRR</span>
        </div>
        <div className="topstat">
          <span className="v num">{s.agentCount}</span>
          <span className="k">agents</span>
        </div>
        <div className="topstat">
          <span className="v num">${s.spendToday.toFixed(2)}</span>
          <span className="k">LLM today</span>
        </div>
        <div className="deptdots" title="Product · Marketing · Finance · CEO · Alerts">
          {(['product', 'marketing', 'finance', 'ceo', 'alerts'] as const).map((d) => (
            <i key={d} style={{ background: DEPT_COLOR[d] }} />
          ))}
        </div>
      </div>
    </header>
  )
}

export default function App() {
  const [mode, setMode] = useState(0)

  useEffect(() => {
    engine.start()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return // don't hijack browser shortcuts
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const n = Number(e.key)
      if (n >= 1 && n <= 8) setMode(n - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <TopBar mode={mode} setMode={setMode} />
      <main className="mode-root">
        {mode === 0 && <Overview />}
        {mode === 1 && <AudienceMap />}
        {mode === 2 && <Product />}
        {mode === 3 && <Finance />}
        {mode === 4 && <Ledger />}
        {mode === 5 && <Competition />}
        {mode === 6 && <Investment />}
        {mode === 7 && <Support />}
      </main>
    </div>
  )
}
