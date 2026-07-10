import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'
import { Button, Card, StatCard, Badge, Alert, Tabs, StatusDot } from '../design-system'
import AppShell from '../components/AppShell'
import { useUnitWebSocket } from '../hooks/useUnitWebSocket'
import { useOrg } from '../contexts/OrgContext'
import ReadingsChart from '../components/ReadingsChart'
import EventsList from '../components/EventsList'
import AlertsList from '../components/AlertsList'
import UnitSettingsPanel from '../components/UnitSettingsPanel'

const CMD_LOCK_MS = 8000

const SENSOR_ACCENTS = {
  temperature: 'var(--teal-500)',
  humidity:    'var(--blue-700)',
  light:       'var(--lime-500)',
}

export default function UnitDetail() {
  const { unitId }       = useParams()
  const { activeOrgId }  = useOrg()

  const { unit, wsConnected, isOffline } = useUnitWebSocket(unitId)

  const [unitMeta, setUnitMeta]       = useState(null)
  const [cmdError, setCmdError]       = useState(null)
  const [cmdLoading, setCmdLoading]   = useState(false)
  const [pumpPending, setPumpPending] = useState(false)
  const [tab, setTab]                 = useState('live')
  const pendingTimer                  = useRef(null)

  const [profiles, setProfiles] = useState([])
  const [alertSummary, setAlertSummary] = useState({ count: 0, hasCritical: false })

  const loadAlertSummary = () => {
    api.getAlerts({ unit_id: unitId, resolved: false })
      .then(data => setAlertSummary({ count: data.length, hasCritical: data.some(a => a.severity === 'critical') }))
      .catch(() => {})
  }

  useEffect(() => {
    api.getUnit(unitId).then(setUnitMeta).catch(() => {})
  }, [unitId])

  useEffect(loadAlertSummary, [unitId])

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
      await api.sendCommand(unitId, pumpState === 'off' ? 'pump_on' : 'pump_off')
      setPumpPending(true)
      pendingTimer.current = setTimeout(() => setPumpPending(false), CMD_LOCK_MS)
    } catch {
      setCmdError('Error al enviar comando. Verifica la conexión.')
    } finally {
      setCmdLoading(false)
    }
  }

  const activeProfile = unitMeta?.active_profile_id
    ? profiles.find(p => p.id === unitMeta.active_profile_id)
    : null

  const pumpState = unit?.pump_state ?? 'off'
  const r         = unit?.readings
  // 'supplying' viene confirmado por el dispositivo (válvula abierta esperando
  // el flotador) — una vez que llega, ya no depende del timer local pumpPending.
  const pumpPhase = pumpState === 'supplying' ? 'supplying'
    : cmdLoading ? 'sending'
    : pumpPending ? 'pending'
    : pumpState === 'on' ? 'on' : 'off'
  const lastSeenStr = unit?.last_seen
    ? new Date(unit.last_seen).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
    : null

  const isOnline = wsConnected && !!unit && !isOffline
  const connectionBadge = (
    <StatusDot
      tone={isOnline ? 'success' : 'neutral'}
      title={isOnline ? 'En línea' : !wsConnected ? 'Reconectando' : !unit ? 'Esperando...' : 'Sin señal'}
    />
  )

  return (
    <AppShell wide>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        <h2 style={{
          fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)',
          fontSize: 'var(--text-xl)', color: 'var(--text-strong)', margin: 0,
        }}>
          {unitMeta?.name ?? 'Cargando...'}
        </h2>
        {connectionBadge}
        {unitMeta?.type === 'totem' && (
          <Badge tone={activeProfile ? 'blue' : 'neutral'}>
            {activeProfile ? activeProfile.name : 'Sin perfil'}
          </Badge>
        )}
      </div>

      <Tabs
        tabs={[
          { id: 'live',     label: 'En vivo'  },
          { id: 'readings', label: 'Lecturas' },
          { id: 'events',   label: 'Eventos'  },
          {
            id: 'alerts',
            label: alertSummary.count > 0
              ? <>Alertas <Badge tone={alertSummary.hasCritical ? 'danger' : 'warning'}>{alertSummary.count}</Badge></>
              : 'Alertas',
          },
          { id: 'settings', label: 'Configuración' },
        ]}
        value={tab} onChange={setTab} style={{ marginBottom: 'var(--space-6)' }}
      />

      {tab === 'live' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <PumpCard
            on={pumpState === 'on'} phase={pumpPhase}
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
              </div>
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
              Esperando datos del dispositivo...
            </p>
          )}
        </div>
      )}

      {tab === 'readings' && <ReadingsChart unitId={unitId} />}
      {tab === 'events'   && <EventsList   unitId={unitId} />}
      {tab === 'alerts'   && <AlertsList   unitId={unitId} onResolved={loadAlertSummary} />}
      {tab === 'settings' && unitMeta && (
        <UnitSettingsPanel unit={unitMeta} profiles={profiles} onUnitChange={setUnitMeta} />
      )}
    </AppShell>
  )
}

function PumpCard({ on, phase, offline, lastSeen, onToggle }) {
  const supplying   = phase === 'supplying'
  const isBlocked   = phase === 'sending' || phase === 'pending' || supplying
  const accentColor = offline ? 'var(--ink-300)' : supplying ? 'var(--status-warning)' : on ? 'var(--green-500)' : 'var(--blue-700)'
  const statusLabel = offline ? 'SIN SEÑAL' : supplying ? 'ABASTECIENDO TANQUE' : on ? 'BOMBA ENCENDIDA' : 'BOMBA APAGADA'
  const statusColor = offline ? 'var(--text-muted)' : supplying ? 'var(--status-warning)' : on ? 'var(--green-600)' : 'var(--text-muted)'
  const dotColor    = offline ? 'var(--ink-300)' : supplying ? 'var(--status-warning)' : on ? 'var(--green-500)' : 'var(--ink-300)'
  const dotGlow     = supplying ? 'var(--status-warning-fill)' : 'var(--green-100)'
  const btnLabel    = phase === 'sending' ? 'Enviando...'
    : phase === 'pending' ? 'Confirmando...'
    : supplying ? 'Esperando nivel de tanque...'
    : on ? 'Apagar bomba' : 'Regar ahora'

  return (
    <Card accent={accentColor}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <span style={{
          width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
          background: dotColor,
          boxShadow: !offline && (on || supplying) ? `0 0 0 3px ${dotGlow}` : 'none',
        }} />
        <span style={{
          fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
          fontSize: 'var(--text-sm)', color: statusColor,
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
      ) : supplying ? (
        <>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
            El nivel de solución es insuficiente — la válvula está abierta llenando el tanque.
            La bomba arrancará sola en cuanto suba el flotador.
          </p>
          <Button fullWidth size="lg" variant="outline" disabled>
            {btnLabel}
          </Button>
        </>
      ) : (
        <Button fullWidth size="lg" variant={on ? 'outline' : 'teal'} disabled={isBlocked} onClick={onToggle}
          style={on ? { borderColor: 'var(--status-danger)', color: 'var(--status-danger)' } : {}}>
          {btnLabel}
        </Button>
      )}
    </Card>
  )
}
