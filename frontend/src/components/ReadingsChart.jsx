import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { api } from '../api'

const SENSORS = [
  { key: 'temperature', label: 'Temperatura', unit: '°C',   color: '#e74c3c' },
  { key: 'humidity',    label: 'Humedad',      unit: '% RH', color: '#3498db' },
  { key: 'light',       label: 'Luz PAR',      unit: 'µmol', color: '#f1c40f' },
  { key: 'co2',         label: 'CO₂',          unit: 'ppm',  color: '#2ecc71' },
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
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {SENSORS.map(s => (
          <button
            key={s.key}
            onClick={() => setSensor(s.key)}
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              border: `1px solid ${sensor === s.key ? s.color : '#333'}`,
              background: sensor === s.key ? s.color + '22' : 'transparent',
              color: sensor === s.key ? s.color : '#666',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: '#555', fontSize: '13px' }}>Cargando...</p>}
      {error   && <p style={{ color: '#e74c3c', fontSize: '13px' }}>{error}</p>}

      {!loading && !error && data.length === 0 && (
        <p style={{ color: '#555', fontSize: '13px' }}>Sin lecturas en las últimas 24 h.</p>
      )}

      {!loading && data.length > 0 && (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#222" />
            <XAxis dataKey="time" tick={{ fill: '#555', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#555', fontSize: 10 }} unit={` ${current.unit}`} width={70} />
            <Tooltip
              contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', fontSize: '12px' }}
              labelStyle={{ color: '#888' }}
              itemStyle={{ color: current.color }}
              formatter={v => [`${v} ${current.unit}`, current.label]}
            />
            <Line type="monotone" dataKey="value" stroke={current.color} dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
