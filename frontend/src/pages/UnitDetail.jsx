import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { s } from './styles'

const POLL_MS = 5000

export default function UnitDetail() {
  const { orgId, unitId } = useParams()
  const navigate          = useNavigate()

  const [unit, setUnit]       = useState(null)
  const [error, setError]     = useState(null)
  const [cmdLoading, setCmdLoading] = useState(false)

  const fetchState = useCallback(async () => {
    try {
      setUnit(await api.getUnitState(unitId))
      setError(null)
    } catch {
      setError('Sin datos del dispositivo')
    }
  }, [unitId])

  useEffect(() => {
    fetchState()
    const t = setInterval(fetchState, POLL_MS)
    return () => clearInterval(t)
  }, [fetchState])

  const togglePump = async () => {
    if (cmdLoading || !unit) return
    setCmdLoading(true)
    const type = unit.pump_on ? 'pump_off' : 'pump_on'
    try {
      await api.sendCommand(unitId, type)
      await fetchState()
    } catch {
      setError('Error al enviar comando')
    } finally {
      setCmdLoading(false)
    }
  }

  const on = unit?.pump_on ?? false
  const r  = unit?.readings

  return (
    <div style={s.page}>
      <header style={s.header}>
        <button style={s.btnGhost} onClick={() => navigate(`/organizations/${orgId}/units`)}>← Volver</button>
        <span style={s.timestamp}>
          {unit?.last_seen
            ? new Date(unit.last_seen).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
            : '--:--'}
        </span>
      </header>

      <div style={s.container}>
        <div style={s.pumpWrap}>
          <button
            style={s.pumpBtn(on, cmdLoading)}
            onClick={togglePump}
            disabled={cmdLoading || !unit}
          >
            <span style={s.pumpAction}>{cmdLoading ? '...' : on ? 'APAGAR' : 'REGAR'}</span>
            <span style={s.pumpStatus}>BOMBA {on ? 'ENCENDIDA' : 'APAGADA'}</span>
          </button>
        </div>

        {r ? (
          <div style={s.sensors}>
            <div style={s.sensor}>
              <span style={s.sensorValue}>{r.temperature ?? '—'}°C</span>
              <span style={s.sensorLabel}>TEMPERATURA</span>
            </div>
            <div style={s.sensor}>
              <span style={s.sensorValue}>{r.humidity ?? '—'}%</span>
              <span style={s.sensorLabel}>HUMEDAD</span>
            </div>
            <div style={s.sensor}>
              <span style={s.sensorValue}>{r.light ?? '—'}</span>
              <span style={s.sensorLabel}>LUZ PAR</span>
            </div>
            <div style={s.sensor}>
              <span style={s.sensorValue}>{r.co2 ?? '—'}</span>
              <span style={s.sensorLabel}>CO₂ PPM</span>
            </div>
          </div>
        ) : (
          <p style={s.muted}>{error ?? 'Esperando datos del dispositivo...'}</p>
        )}
      </div>
    </div>
  )
}
