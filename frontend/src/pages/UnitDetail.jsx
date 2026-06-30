import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { Button, Card, StatCard, Badge, Alert, Select, Tabs } from '../design-system'
import AppShell from '../components/AppShell'
import { useUnitWebSocket } from '../hooks/useUnitWebSocket'
import { useOrg } from '../contexts/OrgContext'
import ReadingsChart from '../components/ReadingsChart'
import EventsList from '../components/EventsList'
import AlertsList from '../components/AlertsList'

const CMD_LOCK_MS = 8000
const TABS = [
  { id: 'live',     label: 'En vivo'  },
  { id: 'readings', label: 'Lecturas' },
  { id: 'events',   label: 'Eventos'  },
  { id: 'alerts',   label: 'Alertas'  },
]

const SENSOR_ACCENTS = {
  temperature: 'var(--teal-500)',
  humidity:    'var(--blue-700)',
  light:       'var(--lime-500)',
  co2:         'var(--ink-500)',
}

export default function UnitDetail() {
  const { unitId }       = useParams()
  const navigate         = useNavigate()
  const { activeOrgId }  = useOrg()

  const { unit, wsConnected, isOffline } = useUnitWebSocket(unitId)

  const [unitMeta, setUnitMeta]       = useState(null)
  const [cmdError, setCmdError]       = useState(null)
  const [cmdLoading, setCmdLoading]   = useState(false)
  const [pumpPending, setPumpPending] = useState(false)
  const [tab, setTab]                 = useState('live')
  const pendingTimer                  = useRef(null)

  const [profiles, setProfiles]                   = useState([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [assignMsg, setAssignMsg]                 = useState(null)
  const [assignError, setAssignError]             = useState(null)
  const [assignLoading, setAssignLoading]         = useState(false)

  useEffect(() => {
    api.getUnit(unitId).then(meta => {
      setUnitMeta(meta)
      if (meta?.active_profile_id) setSelectedProfileId(meta.active_profile_id)
    }).catch(() => {})
  }, [unitId])

  useEffect(() => {
    if (!activeOrgId) return
    api.getProfiles(activeOrgId).then(setProfiles).catch(() => {})
  }, [activeOrgId])

  useEffect(() => {
    if (!unit) return
    setPumpPending(false)
    if (pendingTimer.current) { clearTimeout(pendingTimer.current); pendingTimer.current = null }
  }, [unit])

  useEffect(() => () => { if (pendingTimer.current) clearTimeout(pendingTimer.current) }, [])

  const togglePump = async () => {
    if (cmdLoading || pumpPending || !unit || isOffline) return
    setCmdLoading(true)
    setCmdError(null)
    try {
      await api.sendCommand(unitId, unit.pump_on ? 'pump_off' : 'pump_on')
      setPumpPending(true)
      pendingTimer.current = setTimeout(() => setPumpPending(false), CMD_LOCK_MS)
    } catch {
      setCmdError('Error al enviar comando. Verifica la conexión.')
    } finally {
      setCmdLoading(false)
    }
  }

  const handleAssignProfile = async () => {
    setAssignMsg(null); setAssignError(null); setAssignLoading(true)
    try {
      const res = await api.assignProfile(unitId, selectedProfileId || null)
      setAssignMsg(res?.detail ?? 'Perfil asignado')
    } catch (err) {
      setAssignError(err.message)
    } finally {
      setAssignLoading(false)
    }
  }

  const on        = unit?.pump_on ?? false
  const r         = unit?.readings
  const pumpPhase = cmdLoading ? 'sending' : pumpPending ? 'pending' : on ? 'on' : 'off'
  const lastSeenStr = unit?.last_seen
    ? new Date(unit.last_seen).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
    : null

  const connectionBadge = !wsConnected
    ? <Badge tone="neutral">Reconectando</Badge>
    : !unit
      ? <Badge tone="neutral">Esperando...</Badge>
      : isOffline
        ? <Badge tone="warning">Sin señal</Badge>
        : <Badge tone="success">En línea</Badge>

  return (
    <AppShell wide navRight={connectionBadge}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        <button
          onClick={() => navigate('/units')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            color: 'var(--text-muted)', fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)',
          }}
        >
          ← Unidades
        </button>
        <span style={{ color: 'var(--border-default)' }}>/</span>
        <h2 style={{
          fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)',
          fontSize: 'var(--text-xl)', color: 'var(--text-strong)', margin: 0,
        }}>
          {unitMeta?.name ?? 'Cargando...'}
        </h2>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} style={{ marginBottom: 'var(--space-6)' }} />

      {tab === 'live' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <PumpCard
            on={on} phase={pumpPhase}
            offline={isOffline && !!unit}
            lastSeen={lastSeenStr}
            onToggle={togglePump}
          />

          {cmdError && <Alert tone="danger" onClose={() => setCmdError(null)}>{cmdError}</Alert>}

          {r ? (
            <div>
              <span style={{
                fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
                fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
                display: 'block', marginBottom: 'var(--space-3)',
              }}>
                Lecturas en vivo
                {lastSeenStr && (
                  <span style={{ fontWeight: 'var(--weight-regular)', marginLeft: 'var(--space-2)', color: 'var(--ink-300)' }}>
                    · {lastSeenStr}
                  </span>
                )}
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-3)' }}>
                <StatCard value={r.temperature != null ? `${r.temperature} °C` : '—'} label="Temperatura" accent={SENSOR_ACCENTS.temperature} />
                <StatCard value={r.humidity    != null ? `${r.humidity} %`    : '—'} label="Humedad"      accent={SENSOR_ACCENTS.humidity}    />
                <StatCard value={r.light       != null ? `${r.light}`         : '—'} label="Luz PAR"      accent={SENSOR_ACCENTS.light}       />
                <StatCard value={r.co2         != null ? `${r.co2}`           : '—'} label="CO₂ ppm"      accent={SENSOR_ACCENTS.co2}         />
              </div>
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
              Esperando datos del dispositivo...
            </p>
          )}

          <Card>
            <span style={{
              fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
              fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
              display: 'block', marginBottom: 'var(--space-4)',
            }}>
              Perfil activo
            </span>
            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
              <Select
                style={{ flex: 1 }}
                value={selectedProfileId}
                onChange={e => { setSelectedProfileId(e.target.value); setAssignMsg(null); setAssignError(null) }}
              >
                <option value="">Sin perfil</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Button variant="primary" size="md" onClick={handleAssignProfile} disabled={assignLoading} style={{ flexShrink: 0 }}>
                {assignLoading ? '...' : 'Asignar'}
              </Button>
            </div>
            {assignMsg   && <Alert tone="success" style={{ marginTop: 'var(--space-3)' }}>{assignMsg}</Alert>}
            {assignError && <Alert tone="danger"  style={{ marginTop: 'var(--space-3)' }}>{assignError}</Alert>}
          </Card>
        </div>
      )}

      {tab === 'readings' && <ReadingsChart unitId={unitId} />}
      {tab === 'events'   && <EventsList   unitId={unitId} />}
      {tab === 'alerts'   && <AlertsList   unitId={unitId} />}
    </AppShell>
  )
}

function PumpCard({ on, phase, offline, lastSeen, onToggle }) {
  const isBlocked   = phase === 'sending' || phase === 'pending'
  const accentColor = offline ? 'var(--ink-300)' : on ? 'var(--green-500)' : 'var(--blue-700)'
  const statusLabel = offline ? 'SIN SEÑAL' : on ? 'BOMBA ENCENDIDA' : 'BOMBA APAGADA'
  const btnLabel    = phase === 'sending' ? 'Enviando...' : phase === 'pending' ? 'Confirmando...' : on ? 'Apagar bomba' : 'Regar ahora'

  return (
    <Card accent={accentColor}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <span style={{
          width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
          background: offline ? 'var(--ink-300)' : on ? 'var(--green-500)' : 'var(--ink-300)',
          boxShadow: !offline && on ? '0 0 0 3px var(--green-100)' : 'none',
        }} />
        <span style={{
          fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
          fontSize: 'var(--text-sm)', color: offline ? 'var(--text-muted)' : on ? 'var(--green-600)' : 'var(--text-muted)',
          letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase',
        }}>
          {statusLabel}
        </span>
        {lastSeen && (
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
            {lastSeen}
          </span>
        )}
      </div>
      {offline ? (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          El dispositivo no envía datos. El control no está disponible.
        </p>
      ) : (
        <Button fullWidth size="lg" variant={on ? 'outline' : 'teal'} disabled={isBlocked} onClick={onToggle}
          style={on ? { borderColor: 'var(--status-danger)', color: 'var(--status-danger)' } : {}}>
          {btnLabel}
        </Button>
      )}
    </Card>
  )
}
