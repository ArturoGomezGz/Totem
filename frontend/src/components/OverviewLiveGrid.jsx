import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Card, StatusDot, Badge } from '../design-system'
import { useUnitWebSocket } from '../hooks/useUnitWebSocket'
import { SENSORS } from '../utils/sensors'

// Cuántos sensores caben en una mini-card sin volverla ilegible. Se muestran los
// primeros que la unidad reporte, en el orden de SENSORS: no todos los totems
// traen el mismo set, y fijar la terna dejaba cards llenas de '—' en las
// unidades que no montan CO₂. El set completo vive en el detalle y en la
// cuadrícula — esta vista es panorama, no sustituto del detalle.
const MAX_SUMMARY = 3

export default function OverviewLiveGrid({ units }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      gap: 'var(--space-4)',
    }}>
      {units.map(u => <LiveUnitCard key={u.id} unit={u} />)}
    </div>
  )
}

// Cada card abre su propio WebSocket: el hook es por unidad, y montar un
// componente por totem es lo que permite usarlo sin violar las reglas de hooks.
function LiveUnitCard({ unit }) {
  const { t }      = useTranslation()
  const navigate   = useNavigate()
  const { unit: live, wsConnected, isOffline } = useUnitWebSocket(unit.id)

  const isOnline = wsConnected && !!live && !isOffline
  const r        = live?.readings
  const lastSeen = live?.last_seen ?? unit.last_seen
  const shown    = r ? SENSORS.filter(s => r[s.key] != null).slice(0, MAX_SUMMARY) : []

  return (
    <Card
      interactive
      onClick={() => navigate(`/units/${unit.id}`)}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <StatusDot
          tone={isOnline ? 'success' : 'neutral'}
          title={isOnline ? t('units.online') : t('units.offline')}
        />
        <span style={{
          fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
          fontSize: 'var(--text-base)', color: 'var(--text-strong)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {unit.name}
        </span>
        {live?.pump_state === 'on' && (
          <Badge tone="success" style={{ marginLeft: 'auto' }}>{t('overview.pumpOn')}</Badge>
        )}
      </div>

      {shown.length > 0 ? (
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          {shown.map(meta => (
            <div key={meta.key} style={{ minWidth: 64 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, whiteSpace: 'nowrap' }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontWeight: 'var(--weight-semibold)',
                  fontSize: 'var(--text-lg)', lineHeight: 1, color: meta.hex,
                }}>
                  {r[meta.key]}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{meta.unit}</span>
              </div>
              <span style={{
                fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
                fontSize: '10px', color: 'var(--text-muted)',
                letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase',
              }}>
                {t(meta.labelKey)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: 0 }}>
          {isOnline ? t('unitDetail.waitingDeviceData') : t('overview.noSignal')}
        </p>
      )}

      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)',
        marginTop: 'auto',
      }}>
        {lastSeen
          ? new Date(lastSeen).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
          : '—'}
      </span>
    </Card>
  )
}
