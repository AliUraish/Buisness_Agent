import { useEffect, useMemo, useState } from 'react'
import { engine, Ticket, TicketStatus } from '../sim/engine'
import { useEngineTick } from '../App'

function clock(ts: number) {
  return new Date(ts).toTimeString().slice(0, 5)
}

function ago(ts: number, now: number) {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
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

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'open',
  triaged: 'triaged',
  drafting: 'drafting…',
  review: 'QA review…',
  sent: 'awaiting reply',
  resolved: 'resolved',
  escalated: 'human queue',
}

const TOPIC_LABEL: Record<string, string> = {
  billing: 'billing',
  bug: 'bug',
  'how-to': 'how-to',
  feature: 'feature',
  'churn-risk': 'churn risk',
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function StatsStrip() {
  const s = useEngineTick()
  const open = s.tickets.filter((t) => !['resolved', 'escalated'].includes(t.status)).length
  const escalated = s.tickets.filter((t) => t.status === 'escalated').length
  const resolved = s.tickets.filter((t) => t.status === 'resolved')
  const frMed = median(resolved.map((t) => t.firstResponseMs!).filter((x) => x != null))
  const rated = resolved.filter((t) => t.csat != null)
  const csat = rated.length ? rated.reduce((a, t) => a + t.csat!, 0) / rated.length : null
  return (
    <div className="panel-plain support-stats num">
      {s.linqLive ? <span className="testmode live">LINQ LIVE</span> : <span className="testmode off">LINQ OFF</span>}
      {s.paymentLink ? <span className="testmode live">SUBSCRIBE LINK</span> : <span className="testmode off">NO SUBSCRIBE LINK</span>}
      <button className="start-pill" type="button" onClick={() => void engine.sendOnboard()}>
        Text subscribe link
      </button>
      <span className="sstat">
        <b>{open}</b> open
      </span>
      <span className="sstat">
        <b>{resolved.length}</b> resolved today
      </span>
      <span className="sstat">
        <b>{frMed != null ? `${Math.round(frMed / 1000)}s` : '—'}</b> median first response
      </span>
      <span className="sstat">
        <b>{csat != null ? csat.toFixed(1) : '—'}</b> CSAT
      </span>
      {escalated > 0 && (
        <span className="sstat" style={{ color: 'var(--rose)' }}>
          <b style={{ color: 'var(--rose)' }}>{escalated}</b> in human queue
        </span>
      )}
      <span className="support-bench">
        {['Support Triage', 'Support Writer', 'Support QA'].map((a) => (
          <span key={a} className="tracker-chip">
            <i />
            {a.replace('Support ', '')}
          </span>
        ))}
      </span>
    </div>
  )
}

function Queue({ selected, onSelect }: { selected: number | null; onSelect: (id: number) => void }) {
  const s = useEngineTick()
  const now = useNow(5000)
  const rows = [...s.tickets].reverse()
  return (
    <div className="panel-plain queue-panel">
      <div className="ledger-head">
        <span>Inbox</span>
        <span className="dim-label num">{rows.length} conversations</span>
      </div>
      <div className="queue-scroll">
        <table className="ledger-table num">
          <thead>
            <tr>
              <th>when</th>
              <th>customer</th>
              <th>topic</th>
              <th>pri</th>
              <th className="r">status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr
                key={t.id}
                className={'queue-row' + (selected === t.id ? ' sel' : '')}
                onClick={() => onSelect(t.id)}
              >
                <td className="mono dim">{ago(t.at, now)}</td>
                <td>
                  <b style={{ fontWeight: 500 }}>{t.customer}</b>{' '}
                  <span className="dim">
                    {t.plan} · {t.channel}
                  </span>
                </td>
                <td>{t.topic ? <span className="chip" style={{ marginLeft: 0 }}>{TOPIC_LABEL[t.topic]}</span> : <span className="dim">—</span>}</td>
                <td className={t.priority === 'P1' ? 'pri-hot' : 'dim'}>{t.priority ?? '—'}</td>
                <td className="r">
                  <span className={'status-chip' + (t.status === 'resolved' ? ' pos' : t.status === 'escalated' ? ' neg' : '')}>
                    {STATUS_LABEL[t.status]}
                  </span>
                  {t.csat != null && <span className="csat num"> {t.csat}/5</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Thread({ ticket }: { ticket: Ticket | null }) {
  const now = useNow(10000)
  if (!ticket) return null
  const busy = ticket.status === 'drafting' || ticket.status === 'review'
  return (
    <div className="panel-plain thread-panel">
      <div className="ledger-head">
        <span>
          {ticket.customer} <span className="dim-label num">{ticket.phone} · {ticket.channel}</span>
        </span>
        <span className="dim-label num">
          {ticket.firstResponseMs != null && `first response ${Math.round(ticket.firstResponseMs / 1000)}s · `}
          opened {ago(ticket.at, now)} ago
        </span>
      </div>
      <div className="thread-scroll">
        {ticket.msgs.map((m) => (
          <div key={m.id} className={'bubble-row ' + m.from}>
            <div className={'bubble ' + m.from}>
              <div className="bubble-text">{m.text}</div>
              <div className="bubble-meta num">
                {m.from === 'business_agent' ? `${m.agent ?? 'Business_Agent'} · ${m.via === 'linq' ? 'Linq' : 'sim'} · ` : ''}
                {clock(m.at)}
              </div>
            </div>
          </div>
        ))}
        {busy && (
          <div className="bubble-row business_agent">
            <div className="bubble business_agent ghost">
              <div className="bubble-text dim">{ticket.status === 'drafting' ? 'Support Writer drafting…' : 'Support QA reviewing…'}</div>
            </div>
          </div>
        )}
        {ticket.status === 'escalated' && (
          <div className="escalated-note">
            churn risk — the company does not auto-reply here; waiting on the human queue
          </div>
        )}
      </div>
    </div>
  )
}

export default function Support() {
  const s = useEngineTick()
  const [pinned, setPinned] = useState<number | null>(null)

  // follow the most recently active conversation unless the user pinned one
  const selectedId = useMemo(() => {
    if (pinned != null && s.tickets.some((t) => t.id === pinned)) return pinned
    const byActivity = [...s.tickets].sort(
      (a, b) => (b.msgs[b.msgs.length - 1]?.at ?? b.at) - (a.msgs[a.msgs.length - 1]?.at ?? a.at),
    )
    return byActivity[0]?.id ?? null
  }, [pinned, s.tickets])

  const ticket = s.tickets.find((t) => t.id === selectedId) ?? null

  return (
    <div className="support">
      <StatsStrip />
      <div className="support-cols">
        <Queue selected={selectedId} onSelect={setPinned} />
        <Thread ticket={ticket} />
      </div>
    </div>
  )
}
