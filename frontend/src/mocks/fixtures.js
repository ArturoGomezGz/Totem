// Datos semilla para el modo mock (VITE_USE_MOCKS=true).
// Las formas coinciden con los *Out schemas de server/routers/*.py.

const hoursAgo   = (h) => new Date(Date.now() - h * 3600_000).toISOString()
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString()
const round1     = (n) => Math.round(n * 10) / 10

export function genReadings(hours = 24, stepMin = 20) {
  const steps = Math.floor((hours * 60) / stepMin)
  const now = Date.now()
  const points = []
  let temp = 21, hum = 62

  for (let i = steps; i >= 0; i--) {
    const ts = new Date(now - i * stepMin * 60_000)
    temp = Math.min(29, Math.max(18, temp + (Math.random() - 0.5) * 1.2))
    hum  = Math.min(85, Math.max(45, hum  + (Math.random() - 0.5) * 3))
    const h = ts.getHours()
    const light = h >= 7 && h <= 19 ? 200 + Math.random() * 250 : Math.random() * 20

    points.push({
      timestamp: ts.toISOString(),
      temperature: round1(temp),
      humidity: round1(hum),
      light: round1(light),
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
    {
      id: 'unit-tank-1', organization_id: 'org-demo', type: 'supply_tank', name: 'Tanque Principal',
      is_active: true, firmware_version: '0.9.2', last_seen: minutesAgo(2),
      created_at: hoursAgo(24 * 14), active_profile_id: null,
      target_firmware_release_id: null,
    },
  ]
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
    { id: 'event-1', unit_id: 'unit-totem-1', timestamp: minutesAgo(5), type: 'pump_on',  trigger: 'autonomous' },
    { id: 'event-2', unit_id: 'unit-totem-1', timestamp: minutesAgo(3), type: 'pump_off', trigger: 'autonomous' },
    { id: 'event-3', unit_id: 'unit-totem-1', timestamp: hoursAgo(6),  type: 'pump_on',  trigger: 'manual' },
    { id: 'event-4', unit_id: 'unit-totem-1', timestamp: hoursAgo(6),  type: 'pump_off', trigger: 'manual' },
  ]
}

export function seedReadings() {
  return {
    'unit-totem-1': genReadings(),
    'unit-totem-2': [],
    'unit-tank-1': genReadings(24, 60),
  }
}

export function seedLiveState() {
  return {
    'unit-totem-1': {
      pump_state: 'off',
      readings: { temperature: 22.1, humidity: 61.4, light: 310, timestamp: new Date().toISOString() },
      last_seen: new Date().toISOString(),
    },
    'unit-tank-1': {
      pump_state: 'off',
      readings: { temperature: 24.0, humidity: 58.0, light: null, timestamp: minutesAgo(2) },
      last_seen: minutesAgo(2),
    },
    // unit-totem-2 deliberadamente sin entrada: simula un dispositivo recién
    // registrado que todavía no ha publicado nada ("Esperando datos...").
  }
}
