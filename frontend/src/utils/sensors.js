// Definiciones compartidas por las vistas de lecturas (detalle de unidad y vista
// general multi-totem). Viven aquí para que ambas gráficas ofrezcan exactamente
// los mismos sensores y rangos sin duplicar la lista.

export const SENSORS = [
  { key: 'temperature', labelKey: 'readingsChart.temperature', unit: '°C',   color: 'var(--teal-500)',      hex: '#00A99D' },
  { key: 'humidity',    labelKey: 'readingsChart.humidity',    unit: '% RH', color: 'var(--blue-700)',      hex: '#0077AA' },
  { key: 'light',       labelKey: 'readingsChart.light',       unit: 'µmol', color: 'var(--lime-500)',      hex: '#8DC44A' },
  // Sensores de gas — conteo crudo del ADC (0-4095), sin calibrar todavía.
  { key: 'air_quality', labelKey: 'readingsChart.airQuality',  unit: 'ADC',  color: 'var(--status-warning)', hex: '#E0A52B' },
  { key: 'methane',     labelKey: 'readingsChart.methane',     unit: 'ADC',  color: 'var(--status-danger)',  hex: '#C4453B' },
  // CO2 (Senseair S8, NDIR): ppm ya CALIBRADOS por el sensor, no conteo crudo.
  { key: 'co2',         labelKey: 'readingsChart.co2',         unit: 'ppm',  color: '#7C5CBF',               hex: '#7C5CBF' },
]

// Rangos hacia atrás que el usuario puede elegir. `limit` sube con el rango para
// no truncar histórico denso (el server acepta hasta 5000). El eje se ajusta al
// registro real de cada sensor, así que un rango amplio nunca dibuja vacío.
export const RANGES = [
  { key: '6h',  label: '6 h',  hours: 6,   limit: 500  },
  { key: '24h', label: '24 h', hours: 24,  limit: 1000 },
  { key: '7d',  label: '7 d',  hours: 168, limit: 3000 },
  { key: '30d', label: '30 d', hours: 720, limit: 5000 },
]

// Formato de tick del eje X según el span real de los datos mostrados:
// rangos cortos → hora; rangos de días → fecha corta.
export function makeAxisFmt(spanMs) {
  const DAY = 86_400_000
  if (spanMs <= 1.5 * DAY) {
    return ts => new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  }
  return ts => new Date(ts).toLocaleDateString('es', { day: '2-digit', month: '2-digit' })
}

// Etiqueta completa para el tooltip: siempre fecha + hora, sin ambigüedad.
export function fmtFull(ts) {
  return new Date(ts).toLocaleString('es', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

// Resumen legible del tramo con datos ("21/07 08:15 — 22/07 10:20").
export function fmtSpan(fromTs, toTs) {
  return `${fmtFull(fromTs)} — ${fmtFull(toTs)}`
}
