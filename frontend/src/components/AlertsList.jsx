import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { Button, Alert, Badge } from '../design-system'

function fmt(ts) {
  return new Date(ts).toLocaleString('es', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const SEVERITY_TONE = { critical: 'danger', warning: 'warning' }
const FILTER_OPTS = [['active', 'Activas'], ['resolved', 'Resueltas'], ['all', 'Todas']]

export default function AlertsList({ unitId }) {
  const [alerts, setAlerts]     = useState([])
  const [filter, setFilter]     = useState('active')
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
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
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-5)' }}>
        {FILTER_OPTS.map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFilter(val)}
            style={{
              padding: '6px 16px', borderRadius: 'var(--radius-pill)',
              border: `1px solid ${filter === val ? 'var(--blue-700)' : 'var(--border-default)'}`,
              background: filter === val ? 'var(--blue-050)' : 'var(--surface-card)',
              color: filter === val ? 'var(--blue-700)' : 'var(--text-muted)',
              fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
              fontSize: 'var(--text-sm)', cursor: 'pointer',
              transition: 'all var(--duration-base) var(--ease-standard)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Cargando...</p>}
      {error   && <Alert tone="danger" style={{ marginBottom: 'var(--space-4)' }}>{error}</Alert>}
      {!loading && alerts.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Sin alertas.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {alerts.map(a => {
          const tone = SEVERITY_TONE[a.severity] ?? 'info'
          return (
            <Alert key={a.id} tone={tone}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-2)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                  <Badge tone={tone}>{a.severity}</Badge>
                  <span style={{
                    fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
                    fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
                  }}>
                    {a.type}
                  </span>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                  {fmt(a.timestamp)}
                </span>
              </div>
              {a.message && (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-body)', marginBottom: 'var(--space-2)' }}>
                  {a.message}
                </p>
              )}
              {a.resolved_at ? (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--green-600)', fontFamily: 'var(--font-body)' }}>
                  Resuelta {fmt(a.resolved_at)}
                </p>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleResolve(a.id)}
                  disabled={resolving === a.id}
                  style={{ marginTop: 'var(--space-1)' }}
                >
                  {resolving === a.id ? 'Resolviendo...' : 'Marcar como resuelta'}
                </Button>
              )}
            </Alert>
          )
        })}
      </div>
    </div>
  )
}
