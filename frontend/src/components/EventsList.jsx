import { useState, useEffect } from 'react'
import { api } from '../api'
import { Badge } from '../design-system'

const TYPE_META = {
  pump_on:     { label: 'Bomba encendida', tone: 'success' },
  pump_off:    { label: 'Bomba apagada',   tone: 'neutral' },
  valve_open:  { label: 'Válvula abierta', tone: 'blue'    },
  valve_close: { label: 'Válvula cerrada', tone: 'neutral' },
}

function fmt(ts) {
  return new Date(ts).toLocaleString('es', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function EventsList({ unitId }) {
  const [events, setEvents]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    api.getEvents(unitId)
      .then(data => { setEvents(data); setError(null) })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [unitId])

  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Cargando...</p>
  if (error)   return <p style={{ color: 'var(--status-danger)', fontSize: 'var(--text-sm)' }}>{error}</p>
  if (events.length === 0) return <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Sin eventos en los últimos 7 días.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {events.map(ev => {
        const meta = TYPE_META[ev.type] || { label: ev.type, tone: 'neutral' }
        return (
          <div key={ev.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: 'var(--surface-card)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)', padding: 'var(--space-4)',
            boxShadow: 'var(--shadow-xs)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <span style={{
                fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
                fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
              }}>
                {ev.trigger === 'autonomous' ? 'Autónomo' : 'Manual'}
              </span>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
              {fmt(ev.timestamp)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
