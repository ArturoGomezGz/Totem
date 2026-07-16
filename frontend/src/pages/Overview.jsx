import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Tabs } from '../design-system'
import AppShell from '../components/AppShell'
import { useOrg } from '../contexts/OrgContext'
import { api } from '../api'
import { OFFLINE_MS } from '../hooks/useUnitWebSocket'
import { MAX_SERIES, assignColor, releaseColor } from '../utils/seriesPalette'
import OverviewLiveGrid from '../components/OverviewLiveGrid'
import OverviewLiveTable from '../components/OverviewLiveTable'
import OverviewChart from '../components/OverviewChart'

const isRecentlySeen = (unit) =>
  !!unit.last_seen && Date.now() - new Date(unit.last_seen).getTime() <= OFFLINE_MS

export default function Overview() {
  const { t } = useTranslation()
  const { activeOrgId, activeOrg } = useOrg()

  const [units, setUnits] = useState([])
  const [error, setError] = useState(null)
  const [tab, setTab]     = useState('live')
  // 'cards' resume lo que cada totem sí reporta; 'table' muestra la matriz
  // completa de sensores. Son dos preguntas distintas sobre los mismos datos.
  const [liveView, setLiveView] = useState('cards')

  const [selectedIds, setSelectedIds] = useState([])
  const [colors, setColors]           = useState({})

  useEffect(() => {
    if (!activeOrgId) return
    api.getUnits(activeOrgId)
      .then(data => { setUnits(data); setError(null) })
      .catch(err => setError(err.message))
  }, [activeOrgId])

  // Las que no reportan se van al final: el usuario debe escanear primero lo que
  // sí tiene datos. El orden se fija con el last_seen del fetch, no con el estado
  // en vivo, para que las cards no salten de sitio mientras se las mira.
  const ordered = useMemo(() => {
    const totems = units.filter(u => u.type === 'totem')
    return [...totems].sort((a, b) => {
      const diff = Number(isRecentlySeen(b)) - Number(isRecentlySeen(a))
      return diff !== 0 ? diff : a.name.localeCompare(b.name)
    })
  }, [units])

  // Selección inicial: las primeras unidades con señal, hasta el tope de series.
  useEffect(() => {
    if (ordered.length === 0) return
    setSelectedIds(prev => {
      if (prev.length > 0) return prev
      const seed = ordered.filter(isRecentlySeen).slice(0, MAX_SERIES).map(u => u.id)
      const ids  = seed.length > 0 ? seed : ordered.slice(0, 1).map(u => u.id)
      setColors(ids.reduce((acc, id) => assignColor(acc, id), {}))
      return ids
    })
  }, [ordered])

  const toggleUnit = (id) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) {
        setColors(c => releaseColor(c, id))
        return prev.filter(x => x !== id)
      }
      if (prev.length >= MAX_SERIES) return prev
      setColors(c => assignColor(c, id))
      return [...prev, id]
    })
  }

  if (!activeOrgId) {
    return (
      <AppShell>
        <EmptyState title={t('common.noOrganizationActive')} body={t('units.selectOrgHint')} />
      </AppShell>
    )
  }

  return (
    <AppShell wide>
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <h2 style={{
          fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)',
          fontSize: 'var(--text-xl)', color: 'var(--text-strong)', margin: 0,
        }}>
          {t('overview.title')}
        </h2>
        {activeOrg && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
            {t('overview.subtitle', { org: activeOrg.name, count: ordered.length })}
          </p>
        )}
      </div>

      {error && (
        <Alert tone="danger" style={{ marginBottom: 'var(--space-4)' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {ordered.length === 0 && !error ? (
        <EmptyState title={t('overview.noTotems')} body={t('overview.noTotemsHint')} />
      ) : (
        <>
          <Tabs
            tabs={[
              { id: 'live',     label: t('unitDetail.tabs.live') },
              { id: 'readings', label: t('unitDetail.tabs.readings') },
            ]}
            value={tab} onChange={setTab} style={{ marginBottom: 'var(--space-6)' }}
          />

          {tab === 'live' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-4)' }}>
                <ViewToggle value={liveView} onChange={setLiveView} />
              </div>
              {liveView === 'cards'
                ? <OverviewLiveGrid  units={ordered} />
                : <OverviewLiveTable units={ordered} />}
            </>
          )}

          {tab === 'readings' && (
            <OverviewChart
              units={ordered}
              selectedIds={selectedIds}
              colors={colors}
              onToggleUnit={toggleUnit}
            />
          )}
        </>
      )}
    </AppShell>
  )
}

// Segmented control, el mismo patrón que el selector de rango de las gráficas.
function ViewToggle({ value, onChange }) {
  const { t } = useTranslation()
  const options = [
    { id: 'cards', label: t('overview.viewCards') },
    { id: 'table', label: t('overview.viewTable') },
  ]

  return (
    <div
      role="group"
      aria-label={t('overview.viewToggleLabel')}
      style={{
        display: 'inline-flex', gap: 2, padding: 2,
        background: 'var(--surface-fill)', borderRadius: 'var(--radius-pill)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {options.map(o => {
        const active = value === o.id
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            style={{
              padding: '4px 14px', borderRadius: 'var(--radius-pill)', border: 'none',
              background: active ? 'var(--surface-card)' : 'transparent',
              color: active ? 'var(--text-body)' : 'var(--text-muted)',
              fontFamily: 'var(--font-display)',
              fontWeight: active ? 'var(--weight-semibold)' : 'var(--weight-regular)',
              fontSize: 'var(--text-sm)', cursor: 'pointer', whiteSpace: 'nowrap',
              boxShadow: active ? 'var(--shadow-sm)' : 'none',
              transition: 'all var(--duration-base) var(--ease-standard)',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function EmptyState({ title, body }) {
  return (
    <div style={{
      textAlign: 'center', padding: 'var(--space-8) var(--space-4)',
      border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-md)',
    }}>
      <p style={{
        fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
        fontSize: 'var(--text-base)', color: 'var(--text-strong)', marginBottom: 'var(--space-2)',
      }}>
        {title}
      </p>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{body}</p>
    </div>
  )
}
