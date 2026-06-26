import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { s } from './styles'
import ReadingsChart from '../components/ReadingsChart'
import EventsList from '../components/EventsList'
import AlertsList from '../components/AlertsList'

const POLL_MS    = 5000
const CMD_LOCK_MS = 15000   // ms de espera para que el server confirme el estado
const OFFLINE_MS  = 35000   // sin lectura en este tiempo → unidad sin señal
const TABS = ['En vivo', 'Lecturas', 'Eventos', 'Alertas']

function pumpBtnStyle(on, phase) {
  // phase: 'sending' | 'pending' | 'on' | 'off'
  const neutral = phase === 'sending' || phase === 'pending'
  return {
    width: '200px',
    height: '200px',
    borderRadius: '50%',
    border: 'none',
    cursor: neutral ? 'wait' : 'pointer',
    background: neutral ? '#222' : on ? '#c0392b' : '#27ae60',
    boxShadow: neutral ? 'none'
      : on ? '0 0 48px rgba(192,57,43,0.5)'
           : '0 0 48px rgba(39,174,96,0.4)',
    transition: 'background 0.4s, box-shadow 0.4s, transform 0.1s',
    transform: phase === 'sending' ? 'scale(0.96)' : 'scale(1)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    WebkitTapHighlightColor: 'transparent',
    opacity: neutral ? 0.7 : 1,
  }
}

export default function UnitDetail() {
  const { orgId, unitId } = useParams()
  const navigate          = useNavigate()

  const [unit, setUnit]               = useState(null)
  const [unitMeta, setUnitMeta]       = useState(null)
  const [error, setError]             = useState(null)
  const [cmdLoading, setCmdLoading]   = useState(false)
  const [pumpPending, setPumpPending] = useState(false)
  const [tab, setTab]                 = useState('En vivo')
  const pendingTimer                  = useRef(null)

  const [profiles, setProfiles]                   = useState([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [assignMsg, setAssignMsg]                 = useState(null)
  const [assignError, setAssignError]             = useState(null)
  const [assignLoading, setAssignLoading]         = useState(false)

  const isOffline = u =>
    !u?.last_seen || Date.now() - new Date(u.last_seen).getTime() > OFFLINE_MS

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
    api.getUnit(unitId).then(meta => {
      setUnitMeta(meta)
      if (meta?.active_profile_id) setSelectedProfileId(meta.active_profile_id)
    }).catch(() => {})
  }, [unitId])

  useEffect(() => {
    if (!orgId) return
    api.getProfiles(orgId).then(setProfiles).catch(() => {})
  }, [orgId])

  // Limpiar timer si el componente se desmonta
  useEffect(() => () => { if (pendingTimer.current) clearTimeout(pendingTimer.current) }, [])

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
    if (cmdLoading || pumpPending || !unit || isOffline(unit)) return
    const type = unit.pump_on ? 'pump_off' : 'pump_on'
    setCmdLoading(true)
    try {
      await api.sendCommand(unitId, type)
      // Comando enviado — esperar a que el server confirme el nuevo estado
      setPumpPending(true)
      if (pendingTimer.current) clearTimeout(pendingTimer.current)
      pendingTimer.current = setTimeout(() => setPumpPending(false), CMD_LOCK_MS)
    } catch {
      setError('Error al enviar comando')
    } finally {
      setCmdLoading(false)
    }
  }

  const offline = isOffline(unit)
  const on      = unit?.pump_on ?? false
  const r       = unit?.readings

  // Fase visual del botón
  const pumpPhase = cmdLoading ? 'sending'
    : pumpPending              ? 'pending'
    : on                       ? 'on'
                               : 'off'

  return (
    <div style={s.page}>
      <header style={s.header}>
        <button style={s.btnGhost} onClick={() => navigate(`/organizations/${orgId}/units`)}>← Volver</button>
        {unitMeta?.name && (
          <span style={{ fontSize: '15px', fontWeight: '600', color: '#fff' }}>{unitMeta.name}</span>
        )}
        <span style={{ ...s.timestamp, color: offline && unit ? '#e74c3c' : '#555' }}>
          {unit?.last_seen
            ? new Date(unit.last_seen).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
            : '--:--'}
          {offline && unit ? ' · sin señal' : ''}
        </span>
      </header>

      <div style={s.container}>
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '1px solid #222' }}>
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
              {offline ? (
                <div style={offlinePlaceholder}>
                  <span style={{ fontSize: '13px', color: '#555', letterSpacing: '1px' }}>
                    SIN SEÑAL
                  </span>
                  <span style={{ fontSize: '11px', color: '#444', marginTop: '4px' }}>
                    Control no disponible
                  </span>
                </div>
              ) : (
                <button
                  style={pumpBtnStyle(on, pumpPhase)}
                  onClick={togglePump}
                  disabled={cmdLoading || pumpPending}
                >
                  <span style={s.pumpAction}>
                    {pumpPhase === 'sending' ? '...'
                      : pumpPhase === 'pending' ? 'Espera'
                      : on ? 'APAGAR' : 'REGAR'}
                  </span>
                  <span style={s.pumpStatus}>
                    {pumpPhase === 'sending' ? 'ENVIANDO'
                      : pumpPhase === 'pending' ? 'CONFIRMANDO'
                      : `BOMBA ${on ? 'ENCENDIDA' : 'APAGADA'}`}
                  </span>
                </button>
              )}
            </div>

            {r ? (
              <div style={s.sensors}>
                {[
                  { value: r.temperature, unit: '°C', label: 'TEMPERATURA' },
                  { value: r.humidity,    unit: '%',  label: 'HUMEDAD'     },
                  { value: r.light,       unit: '',   label: 'LUZ PAR'     },
                  { value: r.co2,         unit: '',   label: 'CO₂ PPM'     },
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
                  style={{ ...s.input, flex: 1, appearance: 'none', cursor: 'pointer' }}
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

        {tab === 'Lecturas' && <ReadingsChart unitId={unitId} />}
        {tab === 'Eventos'  && <EventsList   unitId={unitId} />}
        {tab === 'Alertas'  && <AlertsList   unitId={unitId} />}
      </div>
    </div>
  )
}

const offlinePlaceholder = {
  width: '200px',
  height: '200px',
  borderRadius: '50%',
  border: '2px dashed #333',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '4px',
}
