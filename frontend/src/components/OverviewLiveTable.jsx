import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { StatusDot } from '../design-system'
import { useUnitWebSocket } from '../hooks/useUnitWebSocket'
import { SENSORS } from '../utils/sensors'

// Cuadrícula: todos los totems contra todos los sensores, de un vistazo.
// Al contrario que las cards, aquí los nulos SÍ se dibujan como '—': la lectura
// es por columna, y una celda que faltara desalinearía la comparación entre
// unidades — que es justo para lo que sirve esta vista.
export default function OverviewLiveTable({ units }) {
  const { t } = useTranslation()

  return (
    <div style={{
      background: 'var(--surface-card)', border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)',
      // La tabla scrollea dentro de su propio contenedor: con 6 sensores no cabe
      // en móvil, y la página nunca debe scrollear en horizontal.
      overflowX: 'auto',
    }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--surface-card)', zIndex: 1 }}>
              {t('overview.unitColumn')}
            </th>
            {SENSORS.map(s => (
              <th key={s.key} style={th}>
                <span style={{ display: 'block', color: 'var(--text-body)' }}>{t(s.labelKey)}</span>
                <span style={{
                  display: 'block', fontFamily: 'var(--font-mono)', fontSize: '10px',
                  fontWeight: 'var(--weight-regular)', color: 'var(--text-muted)',
                  textTransform: 'none', letterSpacing: 0,
                }}>
                  {s.unit}
                </span>
              </th>
            ))}
            <th style={th}>{t('overview.lastSeenColumn')}</th>
          </tr>
        </thead>
        <tbody>
          {units.map(u => <LiveUnitRow key={u.id} unit={u} />)}
        </tbody>
      </table>
    </div>
  )
}

function LiveUnitRow({ unit }) {
  const { t }    = useTranslation()
  const navigate = useNavigate()
  const { unit: live, wsConnected, isOffline } = useUnitWebSocket(unit.id)

  const isOnline = wsConnected && !!live && !isOffline
  const r        = live?.readings
  const lastSeen = live?.last_seen ?? unit.last_seen

  return (
    <tr
      onClick={() => navigate(`/units/${unit.id}`)}
      style={{ cursor: 'pointer', borderTop: '1px solid var(--border-subtle)' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-fill)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <td style={{ ...td, textAlign: 'left', position: 'sticky', left: 0, background: 'inherit' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <StatusDot
            tone={isOnline ? 'success' : 'neutral'}
            title={isOnline ? t('units.online') : t('units.offline')}
          />
          <span style={{
            fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
            fontSize: 'var(--text-sm)', color: 'var(--text-strong)', whiteSpace: 'nowrap',
          }}>
            {unit.name}
          </span>
        </span>
      </td>

      {SENSORS.map(s => {
        const val = r?.[s.key]
        return (
          <td key={s.key} style={{
            ...td,
            fontFamily: 'var(--font-mono)',
            fontWeight: val != null ? 'var(--weight-semibold)' : 'var(--weight-regular)',
            color: val != null ? s.hex : 'var(--ink-300)',
          }}>
            {val ?? '—'}
          </td>
        )
      })}

      <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
        {lastSeen
          ? new Date(lastSeen).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
          : '—'}
      </td>
    </tr>
  )
}

const th = {
  padding: 'var(--space-3) var(--space-4)',
  textAlign: 'right',
  fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
  fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
  borderBottom: '1px solid var(--border-default)',
  whiteSpace: 'nowrap',
}

const td = {
  padding: 'var(--space-3) var(--space-4)',
  textAlign: 'right',
  fontSize: 'var(--text-sm)',
  whiteSpace: 'nowrap',
}
