// Datos semilla para el modo mock (VITE_USE_MOCKS=true).
// Las formas coinciden con los *Out schemas de server/routers/*.py.

const hoursAgo   = (h) => new Date(Date.now() - h * 3600_000).toISOString()
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString()
const round1     = (n) => Math.round(n * 10) / 10

export const ALL_SENSORS = ['temperature', 'humidity', 'light', 'air_quality', 'methane', 'co2']

// Genera histórico sintético de una unidad.
//
// `gasSinceH`: los sensores de gas (calidad de aire, metano) se agregaron
// después, así que solo tienen histórico en las últimas `gasSinceH` horas —
// antes llegan como null. Reproduce el caso real donde un sensor tiene menos
// registro que los demás y la gráfica debe ajustarse a su propio tramo.
// `bias`: desplaza el punto de partida de temperatura/humedad para que cada
// unidad simulada tenga su propia curva. Sin esto todos los totems generan
// series casi idénticas y la gráfica comparativa no muestra nada útil.
// `sensors`: qué sensores monta esta unidad. En campo no todos los totems
// llevan el mismo set — los que no monta llegan siempre como null, y la UI
// debe distinguir "no lo tiene" de "todavía no ha reportado".
export function genReadings({
  hours = 24 * 30, stepMin = 20, gasSinceH = 8, bias = 0, sensors = ALL_SENSORS,
} = {}) {
  const steps = Math.floor((hours * 60) / stepMin)
  const now = Date.now()
  const points = []
  const has = (k) => sensors.includes(k)
  let temp = 21 + bias, hum = 62 - bias * 2

  for (let i = steps; i >= 0; i--) {
    const ts = new Date(now - i * stepMin * 60_000)
    temp = Math.min(29 + bias, Math.max(18 + bias, temp + (Math.random() - 0.5) * 1.2))
    hum  = Math.min(85, Math.max(45, hum  + (Math.random() - 0.5) * 3))
    const h = ts.getHours()
    const light = h >= 7 && h <= 19 ? 200 + Math.random() * 250 : Math.random() * 20
    const hasGas = i * stepMin <= gasSinceH * 60

    points.push({
      timestamp: ts.toISOString(),
      temperature: has('temperature') ? round1(temp)  : null,
      humidity:    has('humidity')    ? round1(hum)   : null,
      light:       has('light')       ? round1(light) : null,
      air_quality: has('air_quality') && hasGas ? round1(150 + Math.random() * 60)  : null,
      methane:     has('methane')     && hasGas ? round1(300 + Math.random() * 90)  : null,
      co2:         has('co2')         && hasGas ? round1(600 + Math.random() * 400) : null,
    })
  }
  return points.reverse() // más reciente primero, igual que el API real
}

export function seedOrganizations() {
  return [
    { id: 'org-demo', name: 'Invernadero Demo', role: 'admin', created_at: hoursAgo(24 * 20) },
  ]
}

export function seedMembers() {
  return [
    { user_id: 'user-demo', organization_id: 'org-demo', email: 'admin@demo.com', role: 'admin', joined_at: hoursAgo(24 * 20) },
    { user_id: 'user-demo-2', organization_id: 'org-demo', email: 'operador@demo.com', role: 'member', joined_at: hoursAgo(24 * 5) },
  ]
}

export function seedUnits() {
  return [
    {
      id: 'unit-totem-1', organization_id: 'org-demo', type: 'totem', name: 'Totem Norte',
      is_active: true, firmware_version: '1.0.0', last_seen: new Date().toISOString(),
      created_at: hoursAgo(24 * 14), active_profile_id: 'profile-lechuga',
      target_firmware_release_id: 'fw-release-2',
    },
    {
      id: 'unit-totem-2', organization_id: 'org-demo', type: 'totem', name: 'Totem Sur',
      is_active: true, firmware_version: null, last_seen: null,
      created_at: hoursAgo(2), active_profile_id: null,
      target_firmware_release_id: null,
    },
    // Totems 3-6: existen para que la vista general se pueda desarrollar con
    // varias series a la vez (tope de comparación, orden de offline, colisión de
    // colores). 'Totem Poniente' queda sin señal a propósito.
    {
      id: 'unit-totem-3', organization_id: 'org-demo', type: 'totem', name: 'Totem Este',
      is_active: true, firmware_version: '1.0.0', last_seen: new Date().toISOString(),
      created_at: hoursAgo(24 * 12), active_profile_id: 'profile-albahaca',
      target_firmware_release_id: 'fw-release-2',
    },
    {
      id: 'unit-totem-4', organization_id: 'org-demo', type: 'totem', name: 'Totem Oeste',
      is_active: true, firmware_version: '1.0.0', last_seen: new Date().toISOString(),
      created_at: hoursAgo(24 * 11), active_profile_id: 'profile-lechuga',
      target_firmware_release_id: 'fw-release-2',
    },
    {
      id: 'unit-totem-5', organization_id: 'org-demo', type: 'totem', name: 'Totem Central',
      is_active: true, firmware_version: '0.9.2', last_seen: new Date().toISOString(),
      created_at: hoursAgo(24 * 9), active_profile_id: 'profile-albahaca',
      target_firmware_release_id: null,
    },
    // 'Totem Poniente' está sin señal Y en mantenimiento — la combinación real
    // (el técnico la desconectó para intervenirla). Sirve para desarrollar la
    // precedencia: la unidad debe leerse como "en mantenimiento", no como caída.
    {
      id: 'unit-totem-6', organization_id: 'org-demo', type: 'totem', name: 'Totem Poniente',
      is_active: true, firmware_version: '0.9.2', last_seen: hoursAgo(6),
      created_at: hoursAgo(24 * 6), active_profile_id: 'profile-lechuga',
      target_firmware_release_id: null,
      maintenance: {
        id: 'mw-open-1', unit_id: 'unit-totem-6', started_at: hoursAgo(6),
        started_by: 'user-demo-2', started_by_email: 'operador@demo.com',
        ended_at: null, ended_by: null, ended_by_email: null,
        note: 'Cambio de bomba y limpieza de boquillas',
      },
    },
    {
      id: 'unit-tank-1', organization_id: 'org-demo', type: 'supply_tank', name: 'Tanque Principal',
      is_active: true, firmware_version: '0.9.2', last_seen: minutesAgo(2),
      created_at: hoursAgo(24 * 14), active_profile_id: null,
      target_firmware_release_id: null,
    },
  ]
}

// Historial de ventanas por unidad, más reciente primero. La ventana abierta de
// 'Totem Poniente' es el MISMO objeto que su `unit.maintenance` en seedUnits —
// se resuelve en store.js al construir el store, para que cerrarla desde la UI
// actualice ambas vistas.
export function seedMaintenance() {
  return {
    'unit-totem-1': [
      {
        id: 'mw-closed-1', unit_id: 'unit-totem-1',
        started_at: hoursAgo(24 * 3), started_by: 'user-demo', started_by_email: 'admin@demo.com',
        ended_at: hoursAgo(24 * 3 - 2), ended_by: 'user-demo', ended_by_email: 'admin@demo.com',
        note: 'Recalibración del sensor de humedad',
      },
    ],
  }
}

export function seedIrrigationMethods() {
  return [
    {
      key: 'fixed_timer', name: 'Timer fijo',
      description: 'Riega a intervalos y duración constantes, sin retroalimentación ambiental.',
      params_schema: {
        type: 'object',
        required: ['cycle_duration_s', 'min_interval_s'],
        properties: {
          cycle_duration_s: { type: 'number', exclusiveMinimum: 0 },
          min_interval_s: { type: 'number', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
    {
      key: 'vpd_threshold', name: 'Umbral de VPD',
      description: (
        'Riega cuando el Déficit de Presión de Vapor (T, RH) alcanza el umbral del perfil. ' +
        'La duración escala con VPD y con la luz respecto al rango ideal del perfil ' +
        '(base_duration_s × f(VPD) × g(Li)).'
      ),
      params_schema: {
        type: 'object',
        required: ['threshold_vpd_kpa', 'base_duration_s', 'min_interval_s'],
        properties: {
          threshold_vpd_kpa: { type: 'number', exclusiveMinimum: 0 },
          base_duration_s: { type: 'number', exclusiveMinimum: 0 },
          min_interval_s: { type: 'number', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
  ]
}

export function seedFirmwareReleases() {
  return [
    {
      id: 'fw-release-1', organization_id: 'org-demo', version: '0.9.2',
      description: 'Primera versión estable — lectura de sensores y bomba manual.',
      sha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678901234567890abcdef12345',
      uploaded_by: 'user-demo', released_at: hoursAgo(24 * 30),
      download_url: '#', supported_irrigation_methods: ['fixed_timer'],
    },
    {
      id: 'fw-release-2', organization_id: 'org-demo', version: '1.0.0',
      description: 'Agrega buffer offline, reconexión MQTT automática y riego por VPD.',
      sha256: 'f0e1d2c3b4a5968778695a4b3c2d1e0f0918273645afedcba9876543210fed1',
      uploaded_by: 'user-demo', released_at: hoursAgo(24 * 7),
      download_url: '#', supported_irrigation_methods: ['fixed_timer', 'vpd_threshold'],
    },
  ]
}

export function seedProfiles() {
  return [
    {
      id: 'profile-lechuga', organization_id: 'org-demo', name: 'Lechuga mantecosa', species: 'Lactuca sativa',
      temp_min: 18, temp_max: 26, humidity_min: 55, humidity_max: 75,
      light_min: 150, light_max: 400,
      irrigation_method: 'vpd_threshold',
      irrigation_params: { threshold_vpd_kpa: 0.85, base_duration_s: 30, min_interval_s: 900 },
      created_at: hoursAgo(24 * 10), updated_at: hoursAgo(24 * 3),
    },
    {
      id: 'profile-albahaca', organization_id: 'org-demo', name: 'Albahaca', species: 'Ocimum basilicum',
      temp_min: 20, temp_max: 30, humidity_min: 50, humidity_max: 70,
      light_min: 200, light_max: 450,
      irrigation_method: 'vpd_threshold',
      irrigation_params: { threshold_vpd_kpa: 0.95, base_duration_s: 25, min_interval_s: 1200 },
      created_at: hoursAgo(24 * 8), updated_at: hoursAgo(24 * 8),
    },
  ]
}

export function seedAlerts() {
  return [
    {
      id: 'alert-1', unit_id: 'unit-totem-1', timestamp: hoursAgo(1),
      type: 'temp_high', severity: 'warning',
      message: 'Temperatura por encima del rango óptimo (29.4°C)', resolved_at: null,
    },
    {
      id: 'alert-2', unit_id: 'unit-totem-1', timestamp: hoursAgo(30),
      type: 'sensor_offline', severity: 'critical',
      message: 'Sin lecturas del sensor de humedad por más de 1 hora', resolved_at: hoursAgo(29),
    },
  ]
}

export function seedEvents() {
  return [
    // Riego en curso: válvula abierta llenando, aún sin cerrar.
    { id: 'event-1', unit_id: 'unit-totem-1', timestamp: minutesAgo(1),   type: 'valve_open',  trigger: 'autonomous', duration_s: null },
    // Ciclo autónomo completo: llenó 42.8 s y luego bombeó 28.3 s.
    { id: 'event-2', unit_id: 'unit-totem-1', timestamp: minutesAgo(6),   type: 'valve_open',  trigger: 'autonomous', duration_s: null },
    { id: 'event-3', unit_id: 'unit-totem-1', timestamp: minutesAgo(5),   type: 'valve_close', trigger: 'autonomous', duration_s: 42.8 },
    { id: 'event-4', unit_id: 'unit-totem-1', timestamp: minutesAgo(5),   type: 'pump_on',     trigger: 'autonomous', duration_s: null },
    { id: 'event-5', unit_id: 'unit-totem-1', timestamp: minutesAgo(3),   type: 'pump_off',    trigger: 'autonomous', duration_s: 28.3 },
    // Ciclo manual sin fase de llenado: solo bombeó 63 s.
    { id: 'event-6', unit_id: 'unit-totem-1', timestamp: minutesAgo(361), type: 'pump_on',     trigger: 'manual',     duration_s: null },
    { id: 'event-7', unit_id: 'unit-totem-1', timestamp: minutesAgo(360), type: 'pump_off',    trigger: 'manual',     duration_s: 63.0 },
  ]
}

// Cada totem monta un set distinto de sensores, como en campo: solo los más
// nuevos llevan CO₂ y gases, y alguna unidad vieja no trae luxómetro. Sirve
// para ejercitar que la UI muestre lo que hay en vez de una fila de '—'.
export const UNIT_SENSORS = {
  'unit-totem-1': ALL_SENSORS,
  'unit-totem-3': ALL_SENSORS,
  // Sin CO2 ni gases: solo el set climático básico.
  'unit-totem-4': ['temperature', 'humidity', 'light'],
  // Sin luxómetro, pero con la placa de gases completa.
  'unit-totem-5': ['temperature', 'humidity', 'air_quality', 'methane', 'co2'],
  // Unidad mínima: solo temperatura y humedad.
  'unit-totem-6': ['temperature', 'humidity'],
  'unit-tank-1': ['temperature', 'humidity'],
}

export function seedReadings() {
  return {
    'unit-totem-1': genReadings({ sensors: UNIT_SENSORS['unit-totem-1'] }),
    'unit-totem-2': [],
    'unit-totem-3': genReadings({ bias: 2.5, sensors: UNIT_SENSORS['unit-totem-3'] }),
    'unit-totem-4': genReadings({ bias: -3,  sensors: UNIT_SENSORS['unit-totem-4'] }),
    'unit-totem-5': genReadings({ bias: 5,   sensors: UNIT_SENSORS['unit-totem-5'] }),
    // Sin señal desde hace 6 h: tiene histórico, pero se corta ahí.
    'unit-totem-6': genReadings({ bias: -1.5, sensors: UNIT_SENSORS['unit-totem-6'] }).filter(
      r => Date.now() - new Date(r.timestamp).getTime() > 6 * 3600_000
    ),
    'unit-tank-1': genReadings({ hours: 24, stepMin: 60, sensors: UNIT_SENSORS['unit-tank-1'] }),
  }
}

// Anula los sensores que la unidad no monta, para que el estado en vivo diga lo
// mismo que su histórico. Escribir los nulos a mano en cada entrada se
// desincroniza de UNIT_SENSORS a la primera que se edite una de las dos.
function mounted(unitId, readings) {
  const has = UNIT_SENSORS[unitId] ?? ALL_SENSORS
  const out = { timestamp: readings.timestamp }
  for (const k of ALL_SENSORS) out[k] = has.includes(k) ? (readings[k] ?? null) : null
  return out
}

export function seedLiveState() {
  const now = new Date().toISOString()
  return {
    'unit-totem-1': {
      pump_state: 'off',
      readings: mounted('unit-totem-1', { temperature: 22.1, humidity: 61.4, light: 310, air_quality: 165, methane: 320, co2: 780, timestamp: now }),
      last_seen: now,
    },
    'unit-totem-3': {
      pump_state: 'on',
      readings: mounted('unit-totem-3', { temperature: 24.6, humidity: 57.2, light: 295, air_quality: 172, methane: 331, co2: 910, timestamp: now }),
      last_seen: now,
    },
    'unit-totem-4': {
      pump_state: 'off',
      readings: mounted('unit-totem-4', { temperature: 19.3, humidity: 68.9, light: 260, timestamp: now }),
      last_seen: now,
    },
    'unit-totem-5': {
      pump_state: 'off',
      readings: mounted('unit-totem-5', { temperature: 26.8, humidity: 52.5, air_quality: 181, methane: 344, co2: 1120, timestamp: now }),
      last_seen: now,
    },
    'unit-tank-1': {
      pump_state: 'off',
      readings: mounted('unit-tank-1', { temperature: 24.0, humidity: 58.0, timestamp: minutesAgo(2) }),
      last_seen: minutesAgo(2),
    },
    // unit-totem-6 sin entrada viva: perdió señal hace 6 h (ver seedUnits).
    // unit-totem-2 deliberadamente sin entrada: simula un dispositivo recién
    // registrado que todavía no ha publicado nada ("Esperando datos...").
  }
}
