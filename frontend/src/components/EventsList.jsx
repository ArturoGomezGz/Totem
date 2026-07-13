import { useState, useEffect } from 'react'
import { api } from '../api'
import { Badge } from '../design-system'

// Formatea una duración en segundos a texto legible: "28 s" o "1 min 3 s".
// Sin decimales — el backend los trae, pero para el usuario son ruido.
function fmtDur(s) {
  const r = Math.round(s)
  if (r < 60) return `${r} s`
  const m = Math.floor(r / 60)
  const sec = r % 60
  return sec ? `${m} min ${sec} s` : `${m} min`
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString('es', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Agrupa los eventos crudos de actuador (pump_on/off, valve_open/close) en
// ciclos de riego. Como los eventos nunca se solapan, cada ciclo es la fase de
// llenado (valve_open→valve_close) seguida del bombeo (pump_on→pump_off). El
// pump_off cierra el ciclo; los eventos de cierre traen la duración exacta.
// Recibe los eventos como los da la API (más reciente primero) y devuelve los
// ciclos también más reciente primero.
function groupCycles(events) {
  const asc = [...events].reverse()
  const cycles = []
  let cur = null

  const start = (ev) => {
    if (!cur) cur = { startTs: ev.timestamp, trigger: ev.trigger, fill: null, pump: null, filling: false, pumping: false }
  }

  for (const ev of asc) {
    start(ev)
    if (ev.type === 'valve_open') {
      cur.filling = true
    } else if (ev.type === 'valve_close') {
      cur.filling = false
      cur.fill = (cur.fill || 0) + (ev.duration_s || 0)
    } else if (ev.type === 'pump_on') {
      cur.pumping = true
    } else if (ev.type === 'pump_off') {
      cur.pumping = false
      cur.pump = (cur.pump || 0) + (ev.duration_s || 0)
      cur.trigger = ev.trigger || cur.trigger
      cur.endTs = ev.timestamp
      cycles.push({ ...cur, id: ev.id, inProgress: false })
      cur = null
    }
  }

  // Ciclo sin cierre → riego en curso.
  if (cur) cycles.push({ ...cur, id: `live-${cur.startTs}`, inProgress: true })

  return cycles.reverse()
}

function CycleCard({ cycle }) {
  const tone = cycle.inProgress ? 'blue' : 'success'
  const label = cycle.inProgress ? 'Riego en curso' : 'Riego'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
      background: 'var(--surface-card)', border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)', padding: 'var(--space-4)',
      boxShadow: 'var(--shadow-xs)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Badge tone={tone}>{label}</Badge>
          <span style={{
            fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
            fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
          }}>
            {cycle.trigger === 'autonomous' ? 'Autónomo' : 'Manual'}
          </span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          {fmtTime(cycle.startTs)}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {cycle.inProgress && cycle.pump == null ? (
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            {cycle.pumping ? 'Bombeando…' : 'Llenando el tanque…'}
          </span>
        ) : (
          <>
            {cycle.pump != null && (
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-strong)' }}>
                {fmtDur(cycle.pump)} de bombeo
              </span>
            )}
            {cycle.fill != null && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                {cycle.pump != null && '· '}{fmtDur(cycle.fill)} de llenado
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
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

  const cycles = groupCycles(events)
  if (cycles.length === 0) return <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Sin riegos en los últimos 7 días.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {cycles.map(cycle => <CycleCard key={cycle.id} cycle={cycle} />)}
    </div>
  )
}
