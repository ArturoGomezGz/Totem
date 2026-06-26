import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { s } from './styles'
import ReadingsChart from '../components/ReadingsChart'
import EventsList from '../components/EventsList'
import AlertsList from '../components/AlertsList'

const POLL_MS    = 5000
const CMD_LOCK_MS = 15000  // ms que el polling no puede sobrescribir pump_on tras un comando
const TABS = ['En vivo', 'Lecturas', 'Eventos', 'Alertas']

export default function UnitDetail() {
  const { orgId, unitId } = useParams()
  const navigate          = useNavigate()

  const [unit, setUnit]             = useState(null)
  const [unitMeta, setUnitMeta]     = useState(null)
  const [error, setError]           = useState(null)
  const [cmdLoading, setCmdLoading] = useState(false)
  const [tab, setTab]               = useState('En vivo')
  const cmdSentAt = useRef(null)  // timestamp del último comando enviado

  const [profiles, setProfiles]         = useState([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [assignMsg, setAssignMsg]       = useState(null)
  const [assignError, setAssignError]   = useState(null)
  const [assignLoading, setAssignLoading] = useState(false)

  const fetchState = useCallback(async () => {
    try {
      const fresh = await api.getUnitState(unitId)
      setUnit(prev => {
        // Si se envió un comando recientemente, preservar el pump_on local
        // para no revertir el estado optimista antes de que el servidor lo confirme
        const locked = cmdSentAt.current && (Date.now() - cmdSentAt.current) < CMD_LOCK_MS
        if (locked && prev) return { ...fresh, pump_on: prev.pump_on }
        return fresh
      })
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
    api.getUnit(unitId).then(meta => {
      setUnitMeta(meta)
      if (meta?.active_profile_id) setSelectedProfileId(meta.active_profile_id)
    }).catch(() => {})
  }, [unitId])

  useEffect(() => {
    if (!orgId) return
    api.getProfiles(orgId).then(setProfiles).catch(() => {})
  }, [orgId])

  const handleAssignProfile = async () => {
    setAssignMsg(null)
    setAssignError(null)
    setAssignLoading(true)
    try {
      const profileId = selectedProfileId === '' ? null : selectedProfileId
      const res = await api.assignProfile(unitId, profileId)
      setAssignMsg(res?.detail ?? 'OK')
    } catch (err) {
      setAssignError(err.message)
    } finally {
      setAssignLoading(false)
    }
  }

  const togglePump = async () => {
    if (cmdLoading || !unit) return
    const wasOn = unit.pump_on
    const type  = wasOn ? 'pump_off' : 'pump_on'
    // Flip optimista inmediato + bloquear polling por CMD_LOCK_MS
    setUnit(prev => prev ? { ...prev, pump_on: !wasOn } : prev)
    cmdSentAt.current = Date.now()
    setCmdLoading(true)
    try {
      await api.sendCommand(unitId, type)
    } catch {
      // Revertir si el comando falló
      setUnit(prev => prev ? { ...prev, pump_on: wasOn } : prev)
      cmdSentAt.current = null
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

            {/* Perfil activo */}
            <div style={{ marginTop: '32px' }}>
              <p style={{ ...s.cardSub, marginBottom: '10px' }}>PERFIL ACTIVO</p>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  value={selectedProfileId}
                  onChange={e => setSelectedProfileId(e.target.value)}
                  style={{
                    ...s.input,
                    flex: 1,
                    appearance: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="">Sin perfil</option>
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  style={{ ...s.btnSm, flexShrink: 0 }}
                  onClick={handleAssignProfile}
                  disabled={assignLoading}
                >
                  {assignLoading ? '...' : 'Asignar'}
                </button>
              </div>
              {assignMsg   && <p style={{ color: '#27ae60', fontSize: '13px', margin: '6px 0 0' }}>{assignMsg}</p>}
              {assignError && <p style={s.error}>{assignError}</p>}
            </div>
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
