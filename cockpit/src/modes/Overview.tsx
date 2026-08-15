import { useEffect, useRef, useState } from 'react'
import { engine, DEPT_COLOR, Dept } from '../sim/engine'
import { useEngineTick } from '../App'

// ── Org chart geometry (viewBox 1000 × 600) ─────────────────
interface OrgNode {
  id: string
  label: string
  dept: Dept
  x: number
  y: number
  r?: number
}

const NODES: OrgNode[] = [
  { id: 'ceo', label: 'Orchestrator', dept: 'ceo', x: 500, y: 275, r: 30 },
  // Product — top-left
  { id: 'repo', label: 'Repo Agent', dept: 'product', x: 165, y: 115 },
  { id: 'manifest', label: 'Manifest Builder', dept: 'product', x: 325, y: 185 },
  // Marketing — top-right
  { id: 'scraper', label: 'Audience Scraper', dept: 'marketing', x: 650, y: 90 },
  { id: 'sim', label: 'Jury', dept: 'marketing', x: 810, y: 145 },
  { id: 'studio', label: 'Writer Bench', dept: 'marketing', x: 695, y: 210 },
  { id: 'publisher', label: 'Publisher', dept: 'marketing', x: 875, y: 260 },
  // Finance — bottom-right
  { id: 'ledger', label: 'Ledger', dept: 'finance', x: 665, y: 440 },
  { id: 'forecast', label: 'Forecast Ensemble', dept: 'finance', x: 820, y: 385 },
  // Alerts — bottom-left
  { id: 'risk', label: 'Risk Sentinel', dept: 'alerts', x: 320, y: 410 },
  { id: 'terac', label: 'Terac Liaison', dept: 'alerts', x: 170, y: 470 },
]

const NODE_BY_ID = Object.fromEntries(NODES.map((n) => [n.id, n]))

const EDGES: [string, string][] = [
  ['repo', 'manifest'],
  ['manifest', 'ceo'],
  ['ceo', 'studio'],
  ['scraper', 'sim'],
  ['sim', 'studio'],
  ['studio', 'publisher'],
  ['ceo', 'ledger'],
  ['ledger', 'forecast'],
  ['forecast', 'ceo'],
  ['ceo', 'risk'],
  ['risk', 'terac'],
]

const QUADRANTS: { label: string; x: number; y: number; anchor: 'start' | 'end' }[] = [
  { label: 'Product', x: 60, y: 52, anchor: 'start' },
  { label: 'Marketing', x: 940, y: 52, anchor: 'end' },
  { label: 'Finance', x: 940, y: 560, anchor: 'end' },
  { label: 'Alerts / Escalation', x: 60, y: 560, anchor: 'start' },
]

// minimal ink glyphs, drawn in a 20×20 box centered on the node
function Icon({ id }: { id: string }) {
  const s = { stroke: '#111', strokeWidth: 1.4, fill: 'none' as const, strokeLinecap: 'round' as const }
  switch (id) {
    case 'ceo':
      return (
        <g {...s}>
          <circle cx={0} cy={0} r={7} />
          <circle cx={0} cy={0} r={2.4} fill="#111" stroke="none" />
        </g>
      )
    case 'repo':
      return (
        <g {...s}>
          <circle cx={-4} cy={-5} r={2.6} />
          <circle cx={-4} cy={5} r={2.6} />
          <circle cx={5} cy={-5} r={2.6} />
          <path d="M -4 -2.4 V 2.4 M 5 -2.4 C 5 3, -1 3, -1.6 4" />
        </g>
      )
    case 'manifest':
      return (
        <g {...s}>
          <rect x={-6} y={-7.5} width={12} height={15} rx={1.5} />
          <path d="M -3 -3.5 H 3 M -3 0 H 3 M -3 3.5 H 1" />
        </g>
      )
    case 'scraper':
      return (
        <g {...s}>
          <circle cx={-1.5} cy={-1.5} r={5} />
          <path d="M 2.2 2.2 L 6.5 6.5" />
        </g>
      )
    case 'sim':
      return (
        <g {...s}>
          <circle cx={0} cy={-4.5} r={2.6} />
          <circle cx={-5} cy={4} r={2.6} />
          <circle cx={5} cy={4} r={2.6} />
        </g>
      )
    case 'studio':
      return (
        <g {...s}>
          <path d="M -6 6 L 3.5 -3.5 L 6 -6 M -6 6 L -3.5 5.2 L 4.6 -2.4" />
        </g>
      )
    case 'publisher':
      return (
        <g {...s}>
          <path d="M -7 -2 L 7 -5 L 0 7 L -1.5 1 Z M -1.5 1 L 7 -5" strokeLinejoin="round" />
        </g>
      )
    case 'ledger':
      return (
        <g {...s}>
          <path d="M -5 7 V -1 M 0 7 V -6 M 5 7 V 2" />
        </g>
      )
    case 'forecast':
      return (
        <g {...s}>
          <path d="M -7 3 C -3 3, -3 -4, 0 -4 C 3 -4, 3 1, 7 -2" />
        </g>
      )
    case 'risk':
      return (
        <g {...s}>
          <path d="M 0 -7 L 6 -4.5 V 1 C 6 4.5, 3.5 6.5, 0 8 C -3.5 6.5, -6 4.5, -6 1 V -4.5 Z" strokeLinejoin="round" />
        </g>
      )
    case 'terac':
      return (
        <g {...s}>
          <circle cx={0} cy={-3.5} r={3} />
          <path d="M -5.5 7 C -5.5 2.5, 5.5 2.5, 5.5 7" />
        </g>
      )
    default:
      return null
  }
}

function Sparkline({ data, flash }: { data: number[]; flash: boolean }) {
  if (data.length < 2) return null
  const w = 148
  const h = 30
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = Math.max(max - min, 1)
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 3 - ((v - min) / span) * (h - 6)}`).join(' ')
  const last = pts.split(' ').pop()!.split(',').map(Number)
  return (
    <svg className="spark" width={w} height={h}>
      <polyline points={pts} fill="none" stroke="#111" strokeWidth={1} />
      <circle cx={last[0]} cy={last[1]} r={2.2} fill={flash ? '#3fa55c' : '#111'} style={{ transition: 'fill 250ms ease-out' }} />
    </svg>
  )
}

function RevenueTicker() {
  const s = useEngineTick()
  const [shown, setShown] = useState(s.mrr)
  const shownRef = useRef(s.mrr)
  const [flash, setFlash] = useState(false)

  // single effect-owned rAF loop; the setState updater stays pure
  useEffect(() => {
    if (s.mrr === shownRef.current) return
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 900)
    let raf = 0
    const step = () => {
      const d = s.mrr - shownRef.current
      if (Math.abs(d) < 1) {
        shownRef.current = s.mrr
        setShown(s.mrr)
        return
      }
      shownRef.current += Math.sign(d) * Math.max(1, Math.ceil(Math.abs(d) * 0.18))
      setShown(shownRef.current)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      clearTimeout(t)
      cancelAnimationFrame(raf)
    }
  }, [s.mrr])

  return (
    <div className="floor-float tr ticker">
      <div className="mrr-label">MRR</div>
      <div className="mrr num">${Math.round(shown).toLocaleString()}</div>
      <Sparkline data={s.spark} flash={flash} />
    </div>
  )
}

function LoopCounter() {
  const s = useEngineTick()
  return (
    <div className="floor-float tl loopcount">
      <span>
        Full cycles today — <b className="num" style={{ color: 'var(--ink)', fontWeight: 500 }}>{s.loops}</b>
      </span>
      <div className="ticks">
        {Array.from({ length: Math.min(s.loops, 12) }, (_, i) => (
          <svg key={i} width={12} height={12} viewBox="0 0 12 12">
            <path d="M2.5 6.5 L5 9 L9.5 3.5" fill="none" stroke="#111" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ))}
        {s.loops > 12 && <span className="num" style={{ fontSize: 11, color: 'var(--ink-2)' }}>+{s.loops - 12}</span>}
      </div>
    </div>
  )
}

function OrgChart() {
  const s = useEngineTick()
  const [, setFrame] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  // advance particle animation only while particles are alive — stillness by default
  useEffect(() => {
    let raf = 0
    const loop = () => {
      const now = performance.now()
      engine.pruneParticles(now)
      if (engine.state.particles.length > 0) setFrame((f) => f + 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const now = performance.now()

  return (
    <div className="floor" ref={wrapRef}>
      <svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet">
        {/* quadrant labels */}
        {QUADRANTS.map((q) => (
          <text key={q.label} className="dept-label" x={q.x} y={q.y} textAnchor={q.anchor}>
            {q.label}
          </text>
        ))}

        {/* edges */}
        {EDGES.map(([a, b]) => {
          const na = NODE_BY_ID[a]
          const nb = NODE_BY_ID[b]
          return <line key={`${a}>${b}`} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y} stroke="rgba(0,0,0,0.10)" strokeWidth={1} />
        })}

        {/* particles — the only motion on the floor */}
        {s.particles.map((p) => {
          const [a, b] = p.edge.split('>')
          const na = NODE_BY_ID[a]
          const nb = NODE_BY_ID[b]
          if (!na || !nb) return null
          const t = Math.min((now - p.start) / p.duration, 1)
          const e = 1 - Math.pow(1 - t, 2) // ease-out
          const x = na.x + (nb.x - na.x) * e
          const y = na.y + (nb.y - na.y) * e
          return <circle key={p.id} cx={x} cy={y} r={3} fill={p.color} />
        })}

        {/* nodes */}
        {NODES.map((n) => {
          const st = s.nodes[n.id]?.status ?? 'idle'
          const r = n.r ?? 24
          const color = DEPT_COLOR[n.dept]
          const circ = 2 * Math.PI * r
          return (
            <g key={n.id}>
              <circle cx={n.x} cy={n.y} r={r} fill="#fff" stroke="rgba(0,0,0,0.06)" strokeWidth={1} />
              {st === 'thinking' ? (
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={r}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.6}
                  strokeDasharray={`${circ * 0.22} ${circ * 0.78}`}
                  strokeLinecap="round"
                  style={{
                    transformOrigin: `${n.x}px ${n.y}px`,
                    animation: 'ring-sweep 2.8s linear infinite',
                  }}
                />
              ) : (
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={r}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.6}
                  opacity={st === 'acting' ? 1 : 0.4}
                  style={{ transition: 'opacity 250ms ease-out' }}
                />
              )}
              <g transform={`translate(${n.x}, ${n.y})`}>
                <Icon id={n.id} />
              </g>
              <text
                x={n.x}
                y={n.y + r + 16}
                textAnchor="middle"
                fontSize={11}
                fill="var(--ink-2)"
                fontWeight={n.id === 'ceo' ? 500 : 400}
              >
                {n.label}
              </text>
              {/* acting chip */}
              {st === 'acting' && s.nodes[n.id]?.chip && (
                <foreignObject x={n.x - 130} y={n.y - r - 42} width={260} height={36} style={{ overflow: 'visible', pointerEvents: 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <div
                      style={{
                        background: '#fff',
                        border: '1px solid rgba(0,0,0,0.06)',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                        borderRadius: 8,
                        padding: '3px 9px',
                        fontSize: 11,
                        color: '#6b6b6b',
                        whiteSpace: 'nowrap',
                        animation: 'row-in 200ms ease-out',
                      }}
                    >
                      {s.nodes[n.id].chip}
                    </div>
                  </div>
                </foreignObject>
              )}
            </g>
          )
        })}
      </svg>
      <style>{`@keyframes ring-sweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <LoopCounter />
      <RevenueTicker />
    </div>
  )
}

function Feed() {
  const s = useEngineTick()
  const scrollRef = useRef<HTMLDivElement>(null)

  // key on the last event id — feed length pins at its cap, ids never repeat
  const lastId = s.feed.length > 0 ? s.feed[s.feed.length - 1].id : 0
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lastId])

  return (
    <div className="feed">
      <div className="feed-head">
        <span>Activity</span>
        <span className="num">{s.feed.length} events</span>
      </div>
      <div className="feed-scroll" ref={scrollRef}>
        {s.feed.map((e) => (
          <div className="feed-row" key={e.id}>
            <span className="t num">{e.time}</span>
            <span className="dot" style={{ background: DEPT_COLOR[e.dept] }} />
            <span className="agent">{e.agent}</span>
            <span className="msg">
              {e.message}
              {e.deltaUp && (
                <>
                  {' '}
                  <span className="delta-up num">{e.deltaUp} MRR</span>
                </>
              )}
              {e.chips?.map((c) => (
                <span key={c} className="chip">
                  {c}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Overview() {
  return (
    <div className="overview">
      <OrgChart />
      <Feed />
    </div>
  )
}
