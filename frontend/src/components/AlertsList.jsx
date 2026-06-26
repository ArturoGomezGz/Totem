import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

const SEVERITY_COLOR = { critical: '#e74c3c', warning: '#f39c12' }

function fmt(ts) {
  return new Date(ts).toLocaleString('es', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function AlertsList({ unitId }) {
  const [alerts, setAlerts]   = useState([])
  const [filter, setFilter]   = useState('active')
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [resolving, setResolving] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    const resolved = filter === 'active' ? false : filter === 'resolved' ? true : undefined
    api.getAlerts({ unit_id: unitId, resolved })
      .then(data => { setAlerts(data); setError(null) })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [unitId, filter])

  useEffect(() => { load() }, [load])

  const handleResolve = async (alertId) => {
    setResolving(alertId)
    try {
      await api.resolveAlert(alertId)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setResolving(null)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {[['active', 'Activas'], ['resolved', 'Resueltas'], ['all', 'Todas']].map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFilter(val)}
            style={{
              padding: '5px 12px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
              border: `1px solid ${filter === val ? '#888' : '#333'}`,
              background: filter === val ? '#2a2a2a' : 'transparent',
              color: filter === val ? '#fff' : '#555',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: '#555', fontSize: '13px' }}>Cargando...</p>}
      {error   && <p style={{ color: '#e74c3c', fontSize: '13px' }}>{error}</p>}
      {!loading && alerts.length === 0 && (
        <p style={{ color: '#555', fontSize: '13px' }}>Sin alertas.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {alerts.map(a => (
          <div key={a.id} style={{
            background: '#1a1a1a',
            border: `1px solid ${SEVERITY_COLOR[a.severity] ?? '#333'}22`,
            borderLeft: `3px solid ${SEVERITY_COLOR[a.severity] ?? '#555'}`,
            borderRadius: '10px', padding: '12px 14px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
              <span style={{ fontSize: '12px', fontWeight: '600', color: SEVERITY_COLOR[a.severity] ?? '#888', textTransform: 'uppercase', letterSpacing: '1px' }}>
                {a.severity} · {a.type}
              </span>
              <span style={{ fontSize: '11px', color: '#555' }}>{fmt(a.timestamp)}</span>
            </div>
            {a.message && <p style={{ margin: 0, fontSize: '13px', color: '#aaa' }}>{a.message}</p>}
            {a.resolved_at ? (
              <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#27ae60' }}>
                ✓ Resuelta {fmt(a.resolved_at)}
              </p>
            ) : (
              <button
                onClick={() => handleResolve(a.id)}
                disabled={resolving === a.id}
                style={{
                  marginTop: '8px', padding: '3px 10px', fontSize: '11px',
                  background: 'transparent', border: '1px solid #333',
                  borderRadius: '6px', color: '#888', cursor: 'pointer',
                }}
              >
                {resolving === a.id ? '...' : 'Resolver'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
