import { useState, useEffect, useCallback } from 'react'

const UNIT_ID = 'sim-001'
const POLL_MS = 5000

const styles = {
  app: {
    minHeight: '100dvh',
    background: '#111',
    color: '#fff',
    fontFamily: 'system-ui, sans-serif',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '24px 16px',
    boxSizing: 'border-box',
    maxWidth: '480px',
    margin: '0 auto',
  },
  header: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '40px',
  },
  title: { fontSize: '20px', fontWeight: '600', letterSpacing: '2px' },
  timestamp: { fontSize: '12px', color: '#555' },
  pumpWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '48px',
  },
  pumpBtn: (on, loading) => ({
    width: '220px',
    height: '220px',
    borderRadius: '50%',
    border: 'none',
    cursor: loading ? 'wait' : 'pointer',
    background: on ? '#c0392b' : '#27ae60',
    boxShadow: on
      ? '0 0 48px rgba(192,57,43,0.5)'
      : '0 0 48px rgba(39,174,96,0.4)',
    transition: 'background 0.3s, box-shadow 0.3s, transform 0.1s',
    transform: loading ? 'scale(0.96)' : 'scale(1)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    WebkitTapHighlightColor: 'transparent',
  }),
  pumpAction: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#fff',
    letterSpacing: '1px',
  },
  pumpStatus: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: '2px',
  },
  sensors: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    width: '100%',
  },
  sensor: {
    background: '#1e1e1e',
    borderRadius: '16px',
    padding: '20px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  sensorValue: { fontSize: '28px', fontWeight: '600' },
  sensorLabel: { fontSize: '12px', color: '#666', letterSpacing: '1px' },
  msg: { color: '#555', fontSize: '14px', marginTop: '32px' },
}

export default function App() {
  const [unit, setUnit] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchUnit = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/units/${UNIT_ID}`)
      if (!res.ok) throw new Error(res.status)
      setUnit(await res.json())
      setError(null)
    } catch {
      setError('Sin datos')
    }
  }, [])

  useEffect(() => {
    fetchUnit()
    const t = setInterval(fetchUnit, POLL_MS)
    return () => clearInterval(t)
  }, [fetchUnit])

  const togglePump = async () => {
    if (loading) return
    setLoading(true)
    const type = unit?.pump_on ? 'pump_off' : 'pump_on'
    try {
      await fetch(`/api/v1/units/${UNIT_ID}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      await fetchUnit()
    } catch {
      setError('Error al enviar comando')
    } finally {
      setLoading(false)
    }
  }

  const on = unit?.pump_on ?? false
  const r = unit?.readings

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <span style={styles.title}>TOTEM</span>
        <span style={styles.timestamp}>
          {unit?.last_seen
            ? new Date(unit.last_seen).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
            : '--:--'}
        </span>
      </header>

      <div style={styles.pumpWrap}>
        <button
          style={styles.pumpBtn(on, loading)}
          onClick={togglePump}
          disabled={loading || !unit}
        >
          <span style={styles.pumpAction}>
            {loading ? '...' : on ? 'APAGAR' : 'REGAR'}
          </span>
          <span style={styles.pumpStatus}>
            BOMBA {on ? 'ENCENDIDA' : 'APAGADA'}
          </span>
        </button>
      </div>

      {r ? (
        <div style={styles.sensors}>
          <div style={styles.sensor}>
            <span style={styles.sensorValue}>{r.temperature}°C</span>
            <span style={styles.sensorLabel}>TEMPERATURA</span>
          </div>
          <div style={styles.sensor}>
            <span style={styles.sensorValue}>{r.humidity}%</span>
            <span style={styles.sensorLabel}>HUMEDAD</span>
          </div>
          <div style={styles.sensor}>
            <span style={styles.sensorValue}>{r.light}</span>
            <span style={styles.sensorLabel}>LUZ PAR</span>
          </div>
          <div style={styles.sensor}>
            <span style={styles.sensorValue}>{r.co2}</span>
            <span style={styles.sensorLabel}>CO₂ PPM</span>
          </div>
        </div>
      ) : (
        <p style={styles.msg}>{error ?? 'Esperando datos...'}</p>
      )}
    </div>
  )
}
