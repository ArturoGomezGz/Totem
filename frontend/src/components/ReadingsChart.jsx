import { useState, useEffect, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { SENSORS, RANGES, makeAxisFmt, fmtFull, fmtSpan } from '../utils/sensors'

export default function ReadingsChart({ unitId }) {
  const { t } = useTranslation()
  const [rows, setRows]       = useState([])
  const [sensor, setSensor]   = useState('temperature')
  const [range, setRange]     = useState('24h')
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  // El fetch depende solo del rango: una misma respuesta trae todos los sensores,
  // así que cambiar de sensor no recarga nada (filtrado en cliente, instantáneo).
  useEffect(() => {
    const cfg = RANGES.find(r => r.key === range)
    const from = new Date(Date.now() - cfg.hours * 3_600_000).toISOString()
    setLoading(true)
    api.getReadings(unitId, { from, limit: cfg.limit })
      .then(res => { setRows(res); setError(null) })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [unitId, range])

  const current = SENSORS.find(s => s.key === sensor)

  // Puntos del sensor activo, descartando lecturas sin valor (sensores agregados
  // más tarde no tienen histórico completo). El eje se ajusta a lo que quede.
  const data = useMemo(() => {
    return rows
      .filter(r => r[sensor] != null)
      .map(r => ({ ts: new Date(r.timestamp).getTime(), value: r[sensor] }))
      .sort((a, b) => a.ts - b.ts)
  }, [rows, sensor])

  const spanMs   = data.length > 1 ? data[data.length - 1].ts - data[0].ts : 0
  const axisFmt  = makeAxisFmt(spanMs)
  const hasData  = data.length > 0

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

      {error && <p style={{ color: 'var(--status-danger)', fontSize: 'var(--text-sm)' }}>{error}</p>}

      {!error && (
        <div style={{
          background: 'var(--surface-card)', border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)', padding: 'var(--space-4)',
          boxShadow: 'var(--shadow-sm)',
        }}>
          {/* Cabecera del card: sensor + tramo real a la izquierda, selector de
              rango a la derecha. En móvil el selector baja y ocupa todo el ancho. */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-3)',
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
                fontSize: 'var(--text-base)', color: 'var(--text-strong)',
              }}>
                {t(current.labelKey)} <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--weight-regular)' }}>· {current.unit}</span>
              </div>
              {hasData && (
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: '11px',
                  color: 'var(--text-muted)', marginTop: 2,
                }}>
                  {fmtSpan(data[0].ts, data[data.length - 1].ts)}
                </div>
              )}
            </div>

            <RangeSelector value={range} onChange={setRange} />
          </div>

          <div style={{ height: 240, position: 'relative' }}>
            {loading && (
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', margin: 0 }}>
                {t('readingsChart.loading')}
              </p>
            )}

            {!loading && !hasData && (
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', margin: 0, textAlign: 'center', padding: '0 var(--space-4)' }}>
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
                    itemStyle={{ color: current.hex }}
                    labelFormatter={fmtFull}
                    formatter={v => [`${v} ${current.unit}`, t(current.labelKey)]}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={current.hex}
                    dot={false}
                    strokeWidth={2}
                    activeDot={{ r: 4, fill: current.hex, strokeWidth: 0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Segmented control de rango: botones unidos sobre un track hundido. Compacto,
// no compite visualmente con los chips de sensor. En móvil crece a todo el ancho.
export function RangeSelector({ value, onChange }) {
  return (
    <div
      role="group"
      aria-label="Rango de tiempo"
      style={{
        display: 'inline-flex', gap: 2, padding: 2,
        background: 'var(--surface-fill)', borderRadius: 'var(--radius-pill)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {RANGES.map(r => {
        const active = value === r.key
        return (
          <button
            key={r.key}
            onClick={() => onChange(r.key)}
            aria-pressed={active}
            style={{
              padding: '4px 12px', borderRadius: 'var(--radius-pill)', border: 'none',
              background: active ? 'var(--surface-card)' : 'transparent',
              color: active ? 'var(--text-body)' : 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              fontWeight: active ? 'var(--weight-semibold)' : 'var(--weight-regular)',
              fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap',
              boxShadow: active ? 'var(--shadow-sm)' : 'none',
              transition: 'all var(--duration-base) var(--ease-standard)',
            }}
          >
            {r.label}
          </button>
        )
      })}
    </div>
  )
}
