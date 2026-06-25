import { useState, useEffect } from 'react'
import { api } from '../api'

const TYPE_LABEL = {
  pump_on:     { label: 'Bomba encendida', color: '#27ae60' },
  pump_off:    { label: 'Bomba apagada',   color: '#e74c3c' },
  valve_open:  { label: 'Válvula abierta', color: '#3498db' },
  valve_close: { label: 'Válvula cerrada', color: '#95a5a6' },
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

  if (loading) return <p style={{ color: '#555', fontSize: '13px' }}>Cargando...</p>
  if (error)   return <p style={{ color: '#e74c3c', fontSize: '13px' }}>{error}</p>
  if (events.length === 0) return <p style={{ color: '#555', fontSize: '13px' }}>Sin eventos en los últimos 7 días.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {events.map(ev => {
        const meta = TYPE_LABEL[ev.type] || { label: ev.type, color: '#888' }
        return (
          <div key={ev.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: '#1a1a1a', borderRadius: '10px', padding: '12px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
              <div>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: '500' }}>{meta.label}</p>
                <p style={{ margin: 0, fontSize: '11px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  {ev.trigger === 'autonomous' ? 'Autónomo' : 'Manual'}
                </p>
              </div>
            </div>
            <span style={{ fontSize: '11px', color: '#555' }}>{fmt(ev.timestamp)}</span>
          </div>
        )
      })}
    </div>
  )
}
