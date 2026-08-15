import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AUDIENCE, CLUSTERS, clusterCentroid, clusterCounts, layoutPeople, Follower, Tie } from '../data/audience'
import { CampaignSim, DraftPost, JURY, JuryVote, engine } from '../sim/engine'
import { refreshTeracStatus } from '../sim/terac'
import { fetchTryteracAudience } from '../sim/xAudience'
import { useEngineTick } from '../App'

interface Transform {
  x: number
  y: number
  k: number
}

interface Hover {
  f: Follower
  sx: number
  sy: number
}

const JURY_IDS = new Set(JURY.map((j) => j.followerId))
const COLOR_OF: Record<string, string> = Object.fromEntries(CLUSTERS.map((c) => [c.id, c.color]))
const CLUSTER_NAME: Record<string, string> = Object.fromEntries(CLUSTERS.map((c) => [c.id, c.name]))

const STAGE_LABEL: Record<CampaignSim['stage'], string> = {
  idle: 'press Start to queue 5 posts',
  queuing: 'queuing 5 posts',
  writing: '5 agents drafting',
  voting: '9 agents voting',
  reviewing: 'Terac gate',
  posted: 'posted to X (mock)',
}

// natural-language stub: keyword → clusters, "top/high engagement" → top decile
function runQuery(q: string, followers: Follower[]): { ids: Set<number>; summary: string } {
  const query = q.toLowerCase()
  const matchedClusters = CLUSTERS.filter((c) => c.keywords.some((k) => query.includes(k)) || query.includes(c.name.toLowerCase()))
  const wantsTop = /top|high|best|most|engag/.test(query)

  let pool = followers
  let scope = 'all followers'
  if (matchedClusters.length > 0) {
    const ids = new Set(matchedClusters.map((c) => c.id))
    pool = pool.filter((f) => ids.has(f.cluster))
    scope = matchedClusters.map((c) => c.name).join(' + ')
  }

  let result: Follower[]
  let what: string
  if (wantsTop) {
    result = [...pool].sort((a, b) => b.engagement - a.engagement).slice(0, Math.max(8, Math.floor(pool.length * 0.1)))
    what = 'highest-engagement'
  } else if (matchedClusters.length > 0) {
    result = pool
    what = 'all'
  } else {
    result = [...followers].sort((a, b) => b.engagement - a.engagement).slice(0, 40)
    what = 'highest-engagement'
    scope = 'all followers'
  }

  return {
    ids: new Set(result.map((f) => f.id)),
    summary: `${result.length} matches — ${what} in ${scope}`,
  }
}

function tally(votes: JuryVote[], draftId: number) {
  return votes.filter((v) => v.pick === draftId).length
}

function ProductQueue() {
  const s = useEngineTick()
  const queue = s.marketingQueue
  const waiting = queue.filter((q) => q.status === 'queued').length
  return (
    <div className="prod-queue">
      <div className="prod-queue-head">
        <span className="aud-sim-kicker">Product queue</span>
        <span className="aud-sim-title">
          {s.github.live
            ? `${waiting} committed feature${waiting === 1 ? '' : 's'} to post from agentbasis-python-sdk`
            : 'Waiting on GitHub — Product sends features here after a scan'}
        </span>
        {s.github.repo && <span className="prod-queue-repo num">{s.github.repo}</span>}
      </div>
      <div className="prod-queue-row">
        {queue.length === 0 && <div className="gh-empty">No product posts queued yet</div>}
        {queue.map((q) => (
          <button
            key={q.id}
            className={
              'prod-need' +
              (q.id === s.marketingPick && q.status === 'queued' ? ' on' : '') +
              (q.status !== 'queued' ? ' ' + q.status : '')
            }
            disabled={q.status !== 'queued'}
            onClick={() => engine.selectMarketingNeed(q.id)}
          >
            <span className="prod-need-name">{q.feature}</span>
            <span className="prod-need-meta num">
              {q.status === 'queued' ? q.chips[0] ?? 'queued' : q.status}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SimPanel({ sim }: { sim: CampaignSim }) {
  const [teracLive, setTeracLive] = useState(false)
  useEffect(() => {
    let alive = true
    void refreshTeracStatus().then((live) => {
      if (alive) setTeracLive(live)
    })
    return () => {
      alive = false
    }
  }, [])
  const winner = sim.drafts.find((d) => d.id === sim.winnerId)
  const canStart = !sim.busy
  const live = teracLive || sim.terac.live
  const s = useEngineTick()
  const pick = s.marketingQueue.find((q) => q.id === s.marketingPick && q.status === 'queued')
  return (
    <div className="aud-sim">
      <ProductQueue />
      <div className="aud-sim-head">
        <div>
          <span className="testmode">MOCK DATA</span>
          {live ? <span className="testmode live">TERAC LIVE</span> : <span className="testmode off">TERAC OFF</span>}
          <span className="aud-sim-kicker">Writer Bench</span>
          <span className="aud-sim-title">
            {sim.stage === 'idle'
              ? pick
                ? `Start will post ${pick.feature}`
                : '5 agents · queue posts for @zeroco'
              : `campaign #${sim.campaign} — ${sim.feature}`}
          </span>
        </div>
        <div className="aud-sim-actions">
          <span className="aud-sim-stage num">{STAGE_LABEL[sim.stage]}</span>
          <button className="start-pill" disabled={!canStart} onClick={() => engine.startCampaign()}>
            {sim.stage === 'posted' ? 'Start again' : 'Start'}
          </button>
        </div>
      </div>
      {sim.terac.status !== 'idle' && (
        <div className={'terac-strip' + (sim.terac.status === 'revised' || sim.terac.status === 'error' ? ' rev' : '')}>
          <span className="terac-kicker">Terac</span>
          <span>
            {sim.terac.status === 'hiring' && `Opening opportunity · ${sim.terac.title}`}
            {sim.terac.status === 'waiting' && (sim.terac.verdict ?? 'Waiting on a verified expert')}
            {sim.terac.status === 'reviewing' && `${sim.terac.expert ?? 'Expert'} reviewing the winning draft`}
            {sim.terac.status === 'error' && (sim.terac.verdict ?? 'Hire failed')}
            {(sim.terac.status === 'approved' || sim.terac.status === 'revised') && (
              <>
                <b>{sim.terac.expert ?? 'Terac expert'}</b>
                {sim.terac.quote != null ? ` · $${sim.terac.quote}` : ''}
                {` — ${sim.terac.verdict}`}
              </>
            )}
          </span>
          {sim.terac.dashboardUrl ? (
            <a className="terac-job num" href={sim.terac.dashboardUrl} target="_blank" rel="noreferrer">
              {sim.terac.jobId ?? 'dashboard'}
            </a>
          ) : (
            sim.terac.jobId && <span className="terac-job num">{sim.terac.jobId}</span>
          )}
        </div>
      )}
      <div className="draft-row">
        {sim.drafts.map((d) => (
          <DraftCard key={d.id} d={d} sim={sim} winner={winner?.id === d.id} />
        ))}
      </div>
      <div className="jury-row">
        {sim.votes.map((v) => {
          const picked = sim.drafts.find((d) => d.id === v.pick)
          return (
            <div className={'jury-chip' + (v.pick != null ? ' in' : '')} key={v.followerId}>
              <span className="jury-mono" style={{ borderColor: COLOR_OF[v.cluster] }}>
                {v.mono}
              </span>
              <div className="jury-meta">
                <div className="jury-name">
                  {v.handle} <span className="dim">· {v.agent}</span>
                </div>
                <div className="jury-vote">
                  {v.pick == null ? (
                    <span className="dim">{sim.stage === 'voting' ? 'reading drafts…' : 'waiting'}</span>
                  ) : (
                    <>
                      <span className="jury-pick">{picked?.agent}</span>
                      {v.reason ? <span className="dim"> — {v.reason}</span> : null}
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DraftCard({ d, sim, winner }: { d: DraftPost; sim: CampaignSim; winner: boolean }) {
  const votes = tally(sim.votes, d.id)
  return (
    <div className={'draft-card' + (winner ? ' winner' : '') + (d.status === 'writing' ? ' writing' : '')}>
      <div className="draft-head">
        <span className="fcast-mono">{d.mono}</span>
        <span>
          {d.agent}
          <span className="vote-persona"> · {d.voice}</span>
        </span>
        {winner && <span className="draft-win">win</span>}
      </div>
      <div className="draft-body">
        {d.status === 'queued' && <span className="dim">queued</span>}
        {d.status === 'writing' && <span className="dim">drafting…</span>}
        {d.status === 'ready' && d.text}
      </div>
      <div className="draft-foot num">
        {sim.stage === 'voting' || sim.stage === 'reviewing' || sim.stage === 'posted' ? `${votes} vote${votes === 1 ? '' : 's'}` : '@zeroco'}
      </div>
    </div>
  )
}

export default function AudienceMap() {
  const s = useEngineTick()
  const sim = s.campaignSim
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [tf, setTf] = useState<Transform | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [pinned, setPinned] = useState<Follower | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [askOpen, setAskOpen] = useState(false)
  const [askResult, setAskResult] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<Set<number> | null>(null)
  const pulseUntil = useRef(0)
  const dragging = useRef<{ px: number; py: number; moved: boolean } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [source, setSource] = useState<'mock' | 'tryterac'>('mock')
  const [liveGraph, setLiveGraph] = useState<{ followers: Follower[]; ties: Tie[] } | null>(null)
  const [liveNote, setLiveNote] = useState<string | null>(null)
  const [liveMode, setLiveMode] = useState<'followers' | 'mentions' | 'off'>('off')
  const [liveLoading, setLiveLoading] = useState(false)

  const graph = source === 'mock' ? AUDIENCE : (liveGraph ?? { followers: [], ties: [] })
  const mock = source === 'mock'
  const counts = useMemo(() => clusterCounts(graph.followers), [graph])

  useEffect(() => {
    if (source !== 'tryterac' || liveGraph) return
    let alive = true
    setLiveLoading(true)
    void fetchTryteracAudience().then((a) => {
      if (!alive) return
      setLiveMode(a.mode)
      setLiveNote(a.reason)
      if (a.people.length > 0) setLiveGraph(layoutPeople(a.people))
      setLiveLoading(false)
    })
    return () => {
      alive = false
    }
  }, [source, liveGraph])

  useEffect(() => {
    setTf(null)
    setPinned(null)
    setHover(null)
    setHighlight(null)
    setAskResult(null)
    setSelected(null)
  }, [source])

  useEffect(() => {
    if (source === 'tryterac') setTf(null)
  }, [liveGraph, source])

  const centroids = useMemo(
    () => CLUSTERS.map((c) => ({ c, p: clusterCentroid(c.id, graph.followers) })),
    [graph],
  )

  const bounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const f of graph.followers) {
      minX = Math.min(minX, f.x - f.r)
      maxX = Math.max(maxX, f.x + f.r)
      minY = Math.min(minY, f.y - f.r)
      maxY = Math.max(maxY, f.y + f.r)
    }
    if (!Number.isFinite(minX)) return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
    return { minX, maxX, minY, maxY }
  }, [graph])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (size.w === 0 || tf) return
    const pad = Math.min(90, size.w / 4, size.h / 6)
    const padB = Math.min(280, size.h * 0.42)
    const bw = bounds.maxX - bounds.minX
    const bh = bounds.maxY - bounds.minY
    const k = Math.max(0.05, Math.min((size.w - pad * 2) / bw, (size.h - pad - padB) / bh))
    setTf({
      k,
      x: (size.w - bw * k) / 2 - bounds.minX * k,
      y: pad + ((size.h - pad - padB - bh * k) / 2) - bounds.minY * k,
    })
  }, [size, bounds, tf])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setTf((prev) => {
        if (!prev) return prev
        const factor = Math.exp(-e.deltaY * 0.0016)
        const k = Math.min(Math.max(prev.k * factor, 0.25), 6)
        const wx = (mx - prev.x) / prev.k
        const wy = (my - prev.y) / prev.k
        return { k, x: mx - wx * k, y: my - wy * k }
      })
    }
    canvas.addEventListener('wheel', onWheelNative, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheelNative)
  }, [])

  const toScreen = useCallback(
    (wx: number, wy: number) => (tf ? { x: wx * tf.k + tf.x, y: wy * tf.k + tf.y } : { x: 0, y: 0 }),
    [tf],
  )

  const voting = sim.stage === 'voting' || sim.stage === 'reviewing' || sim.stage === 'posted'

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !tf || size.w === 0) return
    const dpr = window.devicePixelRatio || 1
    const bw = Math.round(size.w * dpr)
    const bh = Math.round(size.h * dpr)
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw
      canvas.height = bh
    }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    ctx.translate(tf.x, tf.y)
    ctx.scale(tf.k, tf.k)

    const tnow = performance.now()
    const pulsing = tnow < pulseUntil.current
    const pulsePhase = (tnow % 1200) / 1200

    const byId = graph.followers

    const alphaFor = (f: Follower) => {
      if (pinned) return f.id === pinned.id ? 1 : 0.14
      if (highlight) return highlight.has(f.id) ? 1 : 0.12
      if (selected) return f.cluster === selected ? 1 : 0.15
      return 1
    }

    ctx.setLineDash([2 / tf.k, 4 / tf.k])
    ctx.lineWidth = 1 / tf.k
    for (const t of graph.ties) {
      const a = byId[t.a]
      const b = byId[t.b]
      const alpha = Math.min(alphaFor(a), alphaFor(b))
      ctx.strokeStyle = `rgba(0,0,0,${0.06 * alpha})`
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    ctx.setLineDash([])

    for (const f of byId) {
      const alpha = alphaFor(f)
      const juror = mock && JURY_IDS.has(f.id)
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.lineWidth = (juror && voting ? 2.2 : 1.4) / Math.sqrt(tf.k)
      ctx.strokeStyle = COLOR_OF[f.cluster]
      ctx.stroke()

      if (f.r > 10.4 || juror) {
        ctx.fillStyle = '#6b6b6b'
        ctx.font = `500 ${Math.max(5.5, f.r * 0.62)}px Inter, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(f.initials, f.x, f.y + 0.5)
      } else {
        ctx.beginPath()
        ctx.arc(f.x, f.y, Math.max(1.1, f.r * 0.22), 0, Math.PI * 2)
        ctx.fillStyle = COLOR_OF[f.cluster]
        ctx.fill()
      }

      if (pinned?.id === f.id) {
        ctx.globalAlpha = 1
        ctx.beginPath()
        ctx.arc(f.x, f.y, f.r + 3.2, 0, Math.PI * 2)
        ctx.lineWidth = 1.4 / Math.sqrt(tf.k)
        ctx.strokeStyle = '#111'
        ctx.stroke()
      }

      if (pulsing && highlight?.has(f.id)) {
        ctx.globalAlpha = (1 - pulsePhase) * 0.8
        ctx.beginPath()
        ctx.arc(f.x, f.y, f.r + 2 + pulsePhase * 7, 0, Math.PI * 2)
        ctx.lineWidth = 1.2 / Math.sqrt(tf.k)
        ctx.strokeStyle = COLOR_OF[f.cluster]
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }, [tf, size, selected, highlight, pinned, voting, graph, mock])

  useEffect(() => {
    draw()
  }, [draw])

  useEffect(() => {
    if (!highlight) return
    let raf = 0
    const loop = () => {
      if (performance.now() < pulseUntil.current) {
        draw()
        raf = requestAnimationFrame(loop)
      } else {
        draw()
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [highlight, draw])

  const findAt = useCallback(
    (mx: number, my: number): Follower | null => {
      if (!tf) return null
      const wx = (mx - tf.x) / tf.k
      const wy = (my - tf.y) / tf.k
      let best: Follower | null = null
      let bestD = Infinity
      for (const f of graph.followers) {
        const d = (f.x - wx) ** 2 + (f.y - wy) ** 2
        const hit = (f.r + 2.5) ** 2
        if (d < hit && d < bestD) {
          bestD = d
          best = f
        }
      }
      return best
    },
    [tf, graph],
  )

  const onMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current!.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      if (dragging.current && tf) {
        const dx = mx - dragging.current.px
        const dy = my - dragging.current.py
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragging.current.moved = true
        if (dragging.current.moved) {
          setTf({ ...tf, x: tf.x + dx, y: tf.y + dy })
          dragging.current = { px: mx, py: my, moved: true }
          setHover(null)
        }
        return
      }
      const f = findAt(mx, my)
      if (f) {
        const p = toScreen(f.x, f.y)
        setHover({ f, sx: p.x, sy: p.y - f.r * (tf?.k ?? 1) })
      } else {
        setHover(null)
      }
    },
    [findAt, tf, toScreen],
  )

  const ask = useCallback((q: string) => {
    if (!q.trim()) return
    const { ids, summary } = runQuery(q, graph.followers)
    setSelected(null)
    setPinned(null)
    setHighlight(ids)
    setAskResult(summary)
    pulseUntil.current = performance.now() + 2600
  }, [graph])

  const clearAll = useCallback(() => {
    setSelected(null)
    setHighlight(null)
    setAskResult(null)
    setPinned(null)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearAll()
        setAskOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearAll])

  const total = graph.followers.length
  const pinnedVote = mock && pinned ? sim.votes.find((v) => v.followerId === pinned.id) : undefined
  const pinnedPick = pinnedVote?.pick != null ? sim.drafts.find((d) => d.id === pinnedVote.pick) : undefined
  const sub = mock
    ? `${total.toLocaleString()} followers · mock X graph · 5 clusters`
    : liveLoading
      ? 'loading @tryterac from X…'
      : liveMode === 'followers'
        ? `${total.toLocaleString()} plotted · live X followers of @tryterac`
        : liveMode === 'mentions'
          ? `${total.toLocaleString()} plotted · recent mentions of @tryterac`
          : liveNote ?? 'no live X data'

  return (
    <div className="audience" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className={isDragging ? 'dragging' : hover ? 'hot' : ''}
        style={{ width: size.w, height: size.h }}
        onMouseMove={onMove}
        onMouseDown={(e) => {
          const rect = canvasRef.current!.getBoundingClientRect()
          dragging.current = { px: e.clientX - rect.left, py: e.clientY - rect.top, moved: false }
          setIsDragging(true)
        }}
        onMouseUp={(e) => {
          const moved = dragging.current?.moved ?? false
          dragging.current = null
          setIsDragging(false)
          if (moved) return
          const rect = canvasRef.current!.getBoundingClientRect()
          const f = findAt(e.clientX - rect.left, e.clientY - rect.top)
          if (f) {
            setPinned(f)
            setHighlight(null)
            setAskResult(null)
          } else {
            setPinned(null)
          }
        }}
        onMouseLeave={() => {
          dragging.current = null
          setIsDragging(false)
          setHover(null)
        }}
      />

      {tf &&
        centroids.map(({ c, p }) => {
          const pos = toScreen(p.x, p.y)
          const dim =
            (selected && selected !== c.id) ||
            (pinned && pinned.cluster !== c.id) ||
            (highlight && ![...highlight].some((id) => graph.followers.find((f) => f.id === id)?.cluster === c.id))
          return (
            <div key={c.id} className="cluster-label" style={{ left: pos.x, top: pos.y, opacity: dim ? 0.25 : 1 }}>
              <i style={{ background: c.color }} />
              {c.name}
              <span className="count num">{counts[c.id] ?? 0}</span>
            </div>
          )
        })}

      {hover && !pinned && (
        <div className="persona-tip" style={{ left: hover.sx, top: hover.sy }}>
          <div className="name">
            <span className="dot" style={{ background: COLOR_OF[hover.f.cluster] }} />
            {hover.f.handle} <span className="handle">{hover.f.name}</span>
          </div>
          <div className="meta num">click to pin · {CLUSTER_NAME[hover.f.cluster]}</div>
        </div>
      )}

      <div className="aud-head">
        <div>
          <div className="source-switch">
            <button className={mock ? 'on' : ''} onClick={() => setSource('mock')}>
              Mock swarm
            </button>
            <button className={!mock ? 'on' : ''} onClick={() => setSource('tryterac')}>
              @tryterac
            </button>
          </div>
          <div className="aud-title">Audience Map</div>
          <div className="aud-sub num">{sub}</div>
          {!mock && liveNote && <div className="aud-sub num">{liveNote}</div>}
          <div className="legend">
            {CLUSTERS.map((c) => (
              <button
                key={c.id}
                className={
                  'legend-chip' +
                  (selected === c.id ? ' active' : '') +
                  (selected && selected !== c.id ? ' dimmed' : '')
                }
                onClick={() => {
                  setHighlight(null)
                  setAskResult(null)
                  setPinned(null)
                  setSelected(selected === c.id ? null : c.id)
                }}
              >
                <i style={{ background: c.color }} />
                {c.name}
                <span className="count num">{counts[c.id] ?? 0}</span>
              </button>
            ))}
          </div>

          {pinned && (
            <div className="persona-card">
              <div className="persona-handle">{pinned.handle}</div>
              <div className="persona-name">
                <span className="dot" style={{ background: COLOR_OF[pinned.cluster] }} />
                {pinned.name}
              </div>
              <div className="persona-meta num">
                {pinned.followers.toLocaleString()} followers · engagement {pinned.engagement.toFixed(2)}
              </div>
              <div className="persona-cluster">{CLUSTER_NAME[pinned.cluster]}</div>
              {mock && JURY_IDS.has(pinned.id) && (
                <div className="persona-juror">
                  juror
                  {pinnedPick ? ` · voted ${pinnedPick.agent}` : sim.stage === 'voting' ? ' · deliberating' : ''}
                  {pinnedVote?.reason ? ` — ${pinnedVote.reason}` : ''}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="askwrap">
          <button className="ask-pill" onClick={() => setAskOpen(!askOpen)}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="#111" strokeWidth="1.3" strokeLinecap="round">
              <path d="M2 7.5 C2 4.5 4.2 2.5 7 2.5 C9.8 2.5 12 4.5 12 7.5 C12 10 10 11.8 7.3 11.8 L3.5 11.8 L4.6 10.4" />
            </svg>
            Ask
          </button>
          {askOpen && (
            <div className="ask-box">
              <input
                autoFocus
                placeholder="who are my highest-engagement crypto followers?"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') ask((e.target as HTMLInputElement).value)
                }}
              />
              {askResult ? (
                <div className="ask-result num">{askResult}</div>
              ) : (
                <div className="ask-hint">natural-language query over the follower graph · Enter to run · Esc to clear</div>
              )}
            </div>
          )}
        </div>
      </div>

      <SimPanel sim={sim} />
    </div>
  )
}
