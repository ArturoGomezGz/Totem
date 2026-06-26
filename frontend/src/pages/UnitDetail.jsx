import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { s } from './styles'
import ReadingsChart from '../components/ReadingsChart'
import EventsList from '../components/EventsList'
import AlertsList from '../components/AlertsList'

const POLL_MS = 5000
const TABS = ['En vivo', 'Lecturas', 'Eventos', 'Alertas']

export default function UnitDetail() {
  const { orgId, unitId } = useParams()
  const navigate          = useNavigate()

  const [unit, setUnit]           = useState(null)
  const [unitMeta, setUnitMeta]   = useState(null)
  const [error, setError]         = useState(null)
  const [cmdLoading, setCmdLoading] = useState(false)
  const [tab, setTab]             = useState('En vivo')

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

  useEffect(() => {
    api.getUnit(unitId).then(setUnitMeta).catch(() => {})
  }, [unitId])

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
        {unitMeta?.name && (
          <span style={{ fontSize: '15px', fontWeight: '600', color: '#fff' }}>{unitMeta.name}</span>
        )}
        <span style={s.timestamp}>
          {unit?.last_seen
            ? new Date(unit.last_seen).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
            : '--:--'}
        </span>
      </header>

      <div style={s.container}>
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '1px solid #222', paddingBottom: '0' }}>
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${tab === t ? '#27ae60' : 'transparent'}`,
                color: tab === t ? '#fff' : '#555',
                padding: '8px 14px',
                fontSize: '13px',
                cursor: 'pointer',
                marginBottom: '-1px',
                fontWeight: tab === t ? '600' : '400',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* En vivo */}
        {tab === 'En vivo' && (
          <>
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
                {[
                  { value: r.temperature, unit: '°C',      label: 'TEMPERATURA' },
                  { value: r.humidity,    unit: '%',        label: 'HUMEDAD'     },
                  { value: r.light,       unit: '',         label: 'LUZ PAR'     },
                  { value: r.co2,         unit: '',         label: 'CO₂ PPM'     },
                ].map(({ value, unit, label }) => (
                  <div key={label} style={s.sensor}>
                    <span style={s.sensorValue}>{value != null ? `${value}${unit}` : '—'}</span>
                    <span style={s.sensorLabel}>{label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={s.muted}>{error ?? 'Esperando datos del dispositivo...'}</p>
            )}
          </>
        )}

        {/* Lecturas */}
        {tab === 'Lecturas' && <ReadingsChart unitId={unitId} />}

        {/* Eventos */}
        {tab === 'Eventos' && <EventsList unitId={unitId} />}

        {/* Alertas */}
        {tab === 'Alertas' && <AlertsList unitId={unitId} />}
      </div>
    </div>
  )
}
