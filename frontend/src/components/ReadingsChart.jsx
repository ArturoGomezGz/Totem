import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { api } from '../api'

const SENSORS = [
  { key: 'temperature', label: 'Temperatura', unit: '°C',   color: 'var(--teal-500)',  hex: '#00A99D' },
  { key: 'humidity',    label: 'Humedad',      unit: '% RH', color: 'var(--blue-700)',  hex: '#0077AA' },
  { key: 'light',       label: 'Luz PAR',      unit: 'µmol', color: 'var(--lime-500)',  hex: '#8DC44A' },
  { key: 'co2',         label: 'CO₂',          unit: 'ppm',  color: 'var(--ink-500)',   hex: '#5a6675' },
]

function fmt(ts) {
  return new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

export default function ReadingsChart({ unitId }) {
  const [data, setData]       = useState([])
  const [sensor, setSensor]   = useState('temperature')
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    setLoading(true)
    api.getReadings(unitId)
      .then(rows => {
        setData([...rows].reverse().map(r => ({ time: fmt(r.timestamp), value: r[sensor] })))
        setError(null)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [unitId, sensor])

  const current = SENSORS.find(s => s.key === sensor)

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-5)', flexWrap: 'wrap' }}>
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
              {s.label}
            </button>
          )
        })}
      </div>

      {loading && <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Cargando...</p>}
      {error   && <p style={{ color: 'var(--status-danger)', fontSize: 'var(--text-sm)' }}>{error}</p>}

      {!loading && !error && data.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          Sin lecturas en las últimas 24 h.
        </p>
      )}

      {!loading && data.length > 0 && (
        <div style={{
          background: 'var(--surface-card)', border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)', padding: 'var(--space-4)',
          boxShadow: 'var(--shadow-sm)',
        }}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eaeef2" />
              <XAxis
                dataKey="time"
                tick={{ fill: '#8793a3', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
                interval="preserveStartEnd"
                axisLine={{ stroke: '#d9e0e7' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#8793a3', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
                unit={` ${current.unit}`}
                width={72}
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
                formatter={v => [`${v} ${current.unit}`, current.label]}
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
        </div>
      )}
    </div>
  )
}
