import { useState, useEffect, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { SENSORS, RANGES, makeAxisFmt, fmtFull } from '../utils/sensors'
import { MAX_SERIES } from '../utils/seriesPalette'
import { RangeSelector } from './ReadingsChart'

// Gráfica comparativa: un sensor a la vez, una línea por unidad seleccionada.
// El eje Y es único y compartido — todas las series son el mismo sensor y por
// tanto la misma magnitud y unidad, así que las alturas son comparables.
export default function OverviewChart({ units, selectedIds, colors, onToggleUnit }) {
  const { t } = useTranslation()
  const [sensor, setSensor]   = useState('temperature')
  const [range, setRange]     = useState('24h')
  const [byUnit, setByUnit]   = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const selectedKey = selectedIds.join(',')

  // No existe endpoint agregado: se pide el histórico por unidad y se une aquí.
  // Depende de rango y selección, no del sensor — una respuesta trae todos los
  // sensores, así que cambiar de sensor filtra en cliente sin volver a la red.
  useEffect(() => {
    if (selectedIds.length === 0) { setByUnit({}); setLoading(false); return }
    const cfg  = RANGES.find(r => r.key === range)
    const from = new Date(Date.now() - cfg.hours * 3_600_000).toISOString()
    let cancelled = false

    setLoading(true)
    Promise.all(
      selectedIds.map(id =>
        api.getReadings(id, { from, limit: cfg.limit })
          .then(rows => [id, rows])
          // Una unidad que falla no puede tumbar la comparación completa: se
          // dibuja lo que sí respondió y esa serie queda vacía.
          .catch(() => [id, null])
      )
    ).then(entries => {
      if (cancelled) return
      const next = {}
      let failed = 0
      for (const [id, rows] of entries) {
        if (rows === null) { failed++; next[id] = [] } else next[id] = rows
      }
      setByUnit(next)
      setError(failed > 0 ? t('overview.partialError', { count: failed }) : null)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [selectedKey, range, t])

  const current = SENSORS.find(s => s.key === sensor)

  // Recharts necesita un eje X común. Las unidades no muestrean en el mismo
  // instante, así que se indexan los puntos por timestamp y cada unidad aporta su
  // propia clave; los huecos quedan como undefined y `connectNulls` los cruza.
  const data = useMemo(() => {
    const rowByTs = new Map()
    for (const id of selectedIds) {
      for (const r of byUnit[id] ?? []) {
        if (r[sensor] == null) continue
        const ts = new Date(r.timestamp).getTime()
        if (!rowByTs.has(ts)) rowByTs.set(ts, { ts })
        rowByTs.get(ts)[id] = r[sensor]
      }
    }
    return [...rowByTs.values()].sort((a, b) => a.ts - b.ts)
  }, [byUnit, selectedIds, sensor])

  // Solo las unidades que realmente aportan puntos de este sensor se dibujan y
  // se nombran en la leyenda — una unidad sin histórico no merece entrada.
  const drawn = selectedIds.filter(id => data.some(d => d[id] != null))

  const spanMs  = data.length > 1 ? data[data.length - 1].ts - data[0].ts : 0
  const axisFmt = makeAxisFmt(spanMs)
  const hasData = drawn.length > 0

  const nameOf = (id) => units.find(u => u.id === id)?.name ?? id

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        {SENSORS.map(s => {
          const active = sensor === s.key
          return (
            <button
              key={s.key}
              onClick={() => setSensor(s.key)}
              style={{
                padding: '6px 16px', borderRadius: 'var(--radius-pill)',
                border: `1px solid ${active ? s.hex : 'var(--border-default)'}`,
                background: active ? `${s.hex}18` : 'var(--surface-card)',
                color: active ? s.hex : 'var(--text-muted)',
                fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
                fontSize: 'var(--text-sm)', cursor: 'pointer',
                transition: 'all var(--duration-base) var(--ease-standard)',
              }}
            >
              {t(s.labelKey)}
            </button>
          )
        })}
      </div>

      <UnitSelector
        units={units} selectedIds={selectedIds} colors={colors} onToggle={onToggleUnit}
      />

      {error && (
        <p style={{ color: 'var(--status-warning)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)' }}>
          {error}
        </p>
      )}

      <div style={{
        background: 'var(--surface-card)', border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)', padding: 'var(--space-4)',
        boxShadow: 'var(--shadow-sm)',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-3)',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
              fontSize: 'var(--text-base)', color: 'var(--text-strong)',
            }}>
              {t(current.labelKey)}{' '}
              <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--weight-regular)' }}>
                · {current.unit}
              </span>
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: '11px',
              color: 'var(--text-muted)', marginTop: 2,
            }}>
              {t('overview.comparing', { count: drawn.length })}
            </div>
          </div>

          <RangeSelector value={range} onChange={setRange} />
        </div>

        <div style={{ height: 280, position: 'relative' }}>
          {loading && (
            <p style={centeredMsg}>{t('readingsChart.loading')}</p>
          )}

          {!loading && selectedIds.length === 0 && (
            <p style={centeredMsg}>{t('overview.pickAUnit')}</p>
          )}

          {!loading && selectedIds.length > 0 && !hasData && (
            <p style={centeredMsg}>
              {t('readingsChart.noData', { sensor: t(current.labelKey).toLowerCase() })}
            </p>
          )}

          {!loading && hasData && (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eaeef2" />
                <XAxis
                  dataKey="ts"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={axisFmt}
                  tick={{ fill: '#8793a3', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
                  minTickGap={48}
                  axisLine={{ stroke: '#d9e0e7' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#8793a3', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
                  unit={` ${current.unit}`}
                  width={72}
                  domain={['auto', 'auto']}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: '#ffffff', border: '1px solid #d9e0e7',
                    borderRadius: 8, fontSize: 13,
                    fontFamily: 'Source Sans 3, sans-serif', boxShadow: '0 4px 12px rgba(0,58,92,0.10)',
                  }}
                  labelStyle={{ color: '#5a6675', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 }}
                  labelFormatter={fmtFull}
                  formatter={(v, id) => [`${v} ${current.unit}`, nameOf(id)]}
                />
                {drawn.map(id => (
                  <Line
                    key={id}
                    type="monotone"
                    dataKey={id}
                    name={nameOf(id)}
                    stroke={colors[id]}
                    dot={false}
                    strokeWidth={2}
                    connectNulls
                    activeDot={{ r: 4, fill: colors[id], strokeWidth: 0 }}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Leyenda: el contraste de teal y lime queda bajo 3:1 sobre blanco, así
            que la identidad nunca depende solo del color — cada serie va con su
            nombre escrito en tinta legible. */}
        {hasData && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)',
            marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)',
            borderTop: '1px solid var(--border-subtle)',
          }}>
            {drawn.map(id => (
              <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span style={{ width: 14, height: 2, background: colors[id], flexShrink: 0 }} />
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>{nameOf(id)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Chips de unidad. El chip lleva el color de SU serie, así que la leyenda y el
// selector son el mismo mapa mental. Al llegar al tope se desactivan los chips no
// seleccionados en vez de ciclar colores o desalojar una unidad en silencio.
function UnitSelector({ units, selectedIds, colors, onToggle }) {
  const { t }  = useTranslation()
  const atCap  = selectedIds.length >= MAX_SERIES

  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        {units.map(u => {
          const active   = selectedIds.includes(u.id)
          const disabled = !active && atCap
          const color    = colors[u.id]
          return (
            <button
              key={u.id}
              onClick={() => !disabled && onToggle(u.id)}
              disabled={disabled}
              aria-pressed={active}
              title={disabled ? t('overview.capReached', { max: MAX_SERIES }) : u.name}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                padding: '5px 14px', borderRadius: 'var(--radius-pill)',
                border: `1px solid ${active ? color : 'var(--border-default)'}`,
                background: active ? `${color}14` : 'var(--surface-card)',
                color: active ? 'var(--text-strong)' : 'var(--text-muted)',
                fontFamily: 'var(--font-body)',
                fontWeight: active ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                fontSize: 'var(--text-sm)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.45 : 1,
                transition: 'all var(--duration-base) var(--ease-standard)',
              }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: active ? color : 'var(--ink-300)',
              }} />
              {u.name}
            </button>
          )
        })}
      </div>
      {atCap && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
          {t('overview.capHint', { max: MAX_SERIES })}
        </p>
      )}
    </div>
  )
}

const centeredMsg = {
  color: 'var(--text-muted)', fontSize: 'var(--text-sm)',
  position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
  margin: 0, textAlign: 'center', padding: '0 var(--space-4)',
}
