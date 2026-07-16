// Implementación mock del objeto `api` de ../api.js — misma forma, mismos
// nombres de método, datos en memoria en vez de fetch al server real.
// Se activa con VITE_USE_MOCKS=true (ver frontend/.env.mock).

import { store, setLiveState } from './store'
import { genReadings } from './fixtures'

const uid   = () => crypto.randomUUID()
const delay = (ms = 250) => new Promise(res => setTimeout(res, ms))

function notFound(detail) {
  const err = new Error(detail)
  return Promise.reject(err)
}

function conflict(detail) {
  const err = new Error(detail)
  return Promise.reject(err)
}

// Validador mínimo — replica el subconjunto de JSON Schema que usan los
// params_schema del catálogo (required, properties.type=number,
// additionalProperties=false). No es un validador general de JSON Schema;
// alcanza para los dos métodos definidos en fixtures.js.
function validateAgainstSchema(instance, schema) {
  for (const key of schema.required ?? []) {
    if (!(key in instance)) return `falta el campo requerido "${key}"`
  }
  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(schema.properties ?? {}))
    for (const key of Object.keys(instance)) {
      if (!allowed.has(key)) return `campo no reconocido "${key}"`
    }
  }
  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    if (!(key in instance)) continue
    const value = instance[key]
    if (spec.type === 'number' && typeof value !== 'number') return `"${key}" debe ser numérico`
    if (typeof spec.minimum === 'number' && value < spec.minimum) return `"${key}" debe ser >= ${spec.minimum}`
    if (typeof spec.exclusiveMinimum === 'number' && value <= spec.exclusiveMinimum) return `"${key}" debe ser > ${spec.exclusiveMinimum}`
  }
  return null
}

function validateIrrigationMethod(irrigation_method, irrigation_params) {
  const method = store.irrigationMethods.find(m => m.key === irrigation_method)
  if (!method) throw new Error(`Método de riego desconocido: ${irrigation_method}`)
  const error = validateAgainstSchema(irrigation_params, method.params_schema)
  if (error) throw new Error(`irrigation_params inválido para ${irrigation_method}: ${error}`)
}

export const mockApi = {
  // ---------- Auth ----------
  register: async (_email, _password) => {
    await delay()
    return { id: uid(), email: _email, created_at: new Date().toISOString() }
  },
  login: async (_email, _password) => {
    await delay()
    return { access_token: 'mock-access-token', token_type: 'bearer', refresh_token: 'mock-refresh-token' }
  },
  refresh: async (_refresh_token) => {
    await delay()
    return { access_token: 'mock-access-token', token_type: 'bearer', refresh_token: 'mock-refresh-token' }
  },
  logout: async (_refresh_token) => { await delay(100); return null },

  // ---------- Organizations ----------
  getOrganizations: async () => { await delay(); return store.organizations },
  createOrganization: async (name) => {
    await delay()
    const org = { id: uid(), name, role: 'admin', created_at: new Date().toISOString() }
    store.organizations.push(org)
    return org
  },
  updateOrganization: async (organization_id, name) => {
    await delay()
    const org = store.organizations.find(o => o.id === organization_id)
    if (!org) return notFound('Organización no encontrada')
    org.name = name
    return org
  },

  // ---------- Members ----------
  getMembers: async (organization_id) => {
    await delay()
    return store.members.filter(m => m.organization_id === organization_id)
  },
  addMember: async (organization_id, email, role) => {
    await delay()
    const existing = store.members.find(m => m.organization_id === organization_id && m.email === email)
    if (existing) return notFound('El usuario ya es miembro de esta organización')
    const member = { user_id: uid(), organization_id, email, role: role || 'member', joined_at: new Date().toISOString() }
    store.members.push(member)
    return member
  },
  updateMemberRole: async (organization_id, user_id, role) => {
    await delay()
    const member = store.members.find(m => m.organization_id === organization_id && m.user_id === user_id)
    if (!member) return notFound('El usuario no es miembro de esta organización')
    const admins = store.members.filter(m => m.organization_id === organization_id && m.role === 'admin')
    if (member.role === 'admin' && role !== 'admin' && admins.length <= 1) {
      return notFound('No puedes quitar al último administrador de la organización')
    }
    member.role = role
    return member
  },
  removeMember: async (organization_id, user_id) => {
    await delay()
    const member = store.members.find(m => m.organization_id === organization_id && m.user_id === user_id)
    if (!member) return notFound('El usuario no es miembro de esta organización')
    const admins = store.members.filter(m => m.organization_id === organization_id && m.role === 'admin')
    if (member.role === 'admin' && admins.length <= 1) {
      return notFound('No puedes quitar al último administrador de la organización')
    }
    store.members = store.members.filter(m => !(m.organization_id === organization_id && m.user_id === user_id))
    return null
  },

  // ---------- Units ----------
  getUnits: async (organization_id) => {
    await delay()
    return store.units.filter(u => u.organization_id === organization_id)
  },
  createUnit: async (body) => {
    await delay()
    const unit = {
      id: uid(), organization_id: body.organization_id, type: body.type, name: body.name,
      is_active: true, firmware_version: null, last_seen: null,
      created_at: new Date().toISOString(), active_profile_id: null,
      maintenance: null,
    }
    store.units.push(unit)
    store.readings[unit.id] = []
    return { ...unit, api_key: `mock-${unit.type}-${unit.id.slice(0, 8)}-api-key` }
  },
  getUnit: async (unit_id) => {
    await delay()
    const unit = store.units.find(u => u.id === unit_id)
    if (!unit) return notFound('Unidad no encontrada')
    return unit
  },
  patchUnit: async (unit_id, body) => {
    await delay()
    const unit = store.units.find(u => u.id === unit_id)
    if (!unit) return notFound('Unidad no encontrada')
    unit.name = body.name
    return unit
  },
  regenerateUnitKey: async (unit_id) => {
    await delay()
    const unit = store.units.find(u => u.id === unit_id)
    if (!unit) return notFound('Unidad no encontrada')
    const api_key = `mock-${unit.type}-${unit.id.slice(0, 8)}-regenerated-${Date.now().toString(36)}`
    return { ...unit, api_key }
  },
  deactivateUnit: async (unit_id) => {
    await delay()
    const unit = store.units.find(u => u.id === unit_id)
    if (!unit) return notFound('Unidad no encontrada')
    unit.is_active = false
    return null
  },
  startMaintenance: async (unit_id, note) => {
    await delay()
    const unit = store.units.find(u => u.id === unit_id)
    if (!unit) return notFound('Unidad no encontrada')
    if (unit.maintenance) return conflict('La unidad ya está en mantenimiento')
    const window = {
      id: uid(), unit_id, started_at: new Date().toISOString(),
      started_by: store.currentUser.id, started_by_email: store.currentUser.email,
      ended_at: null, ended_by: null, ended_by_email: null, note: note || null,
    }
    store.maintenance[unit_id] = [window, ...(store.maintenance[unit_id] ?? [])]
    unit.maintenance = window
    return window
  },
  endMaintenance: async (unit_id) => {
    await delay()
    const unit = store.units.find(u => u.id === unit_id)
    if (!unit) return notFound('Unidad no encontrada')
    if (!unit.maintenance) return notFound('La unidad no está en mantenimiento')
    const window = store.maintenance[unit_id].find(w => w.id === unit.maintenance.id)
    window.ended_at       = new Date().toISOString()
    window.ended_by       = store.currentUser.id
    window.ended_by_email = store.currentUser.email
    unit.maintenance = null
    return window
  },
  getMaintenance: async (unit_id, limit = 20) => {
    await delay()
    const unit = store.units.find(u => u.id === unit_id)
    if (!unit) return notFound('Unidad no encontrada')
    return (store.maintenance[unit_id] ?? []).slice(0, limit)
  },

  getUnitState: async (unit_id) => {
    await delay(100)
    const live = store.liveState[unit_id]
    if (!live) return notFound('Unidad no encontrada o sin datos aun')
    return live
  },

  // ---------- Commands ----------
  sendCommand: async (unit_id, type) => {
    await delay(200)
    if (type === 'pump_off') {
      // Deriva la duración del bombeo a partir del último pump_on de la unidad,
      // igual que el firmware adjunta duration_s al evento de cierre.
      const lastOn = store.events.find(e => e.unit_id === unit_id && e.type === 'pump_on')
      const duration_s = lastOn ? (Date.now() - new Date(lastOn.timestamp).getTime()) / 1000 : null
      setLiveState(unit_id, { pump_state: 'off', last_seen: new Date().toISOString() })
      store.events.unshift({ id: uid(), unit_id, timestamp: new Date().toISOString(), type, trigger: 'manual', duration_s })
      return { detail: 'Comando enviado' }
    }

    // Simula el flotador del módulo de suministro (ver genesis.c): la mitad
    // de las veces el nivel ya alcanza y la bomba arranca directo, la otra
    // mitad pasa primero por "abasteciendo" hasta que sube el flotador.
    const needsSupply = Math.random() < 0.5
    if (needsSupply) {
      setLiveState(unit_id, { pump_state: 'supplying', last_seen: new Date().toISOString() })
      setTimeout(() => {
        setLiveState(unit_id, { pump_state: 'on', last_seen: new Date().toISOString() })
        store.events.unshift({ id: uid(), unit_id, timestamp: new Date().toISOString(), type: 'pump_on', trigger: 'manual' })
      }, 3000)
    } else {
      setLiveState(unit_id, { pump_state: 'on', last_seen: new Date().toISOString() })
      store.events.unshift({ id: uid(), unit_id, timestamp: new Date().toISOString(), type: 'pump_on', trigger: 'manual' })
    }
    return { detail: 'Comando enviado' }
  },

  // ---------- Readings / Events ----------
  getReadings: async (unit_id, params = {}) => {
    await delay()
    let rows = store.readings[unit_id] ?? []
    // Espeja el endpoint real: filtra por rango temporal antes de limitar.
    if (params.from) rows = rows.filter(r => new Date(r.timestamp) >= new Date(params.from))
    if (params.to)   rows = rows.filter(r => new Date(r.timestamp) <= new Date(params.to))
    const limit = params.limit ?? 500
    return rows.slice(0, limit)
  },
  getEvents: async (unit_id, params = {}) => {
    await delay()
    // Igual que el endpoint real (units.py): más reciente primero.
    const rows = store.events
      .filter(e => e.unit_id === unit_id)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    const limit = params.limit ?? 200
    return rows.slice(0, limit)
  },

  // ---------- Alerts ----------
  getAlerts: async (params = {}) => {
    await delay()
    let rows = store.alerts
    if (params.unit_id) rows = rows.filter(a => a.unit_id === params.unit_id)
    if (params.resolved === true) rows = rows.filter(a => a.resolved_at != null)
    if (params.resolved === false) rows = rows.filter(a => a.resolved_at == null)
    return rows
  },
  resolveAlert: async (alert_id) => {
    await delay()
    const alert = store.alerts.find(a => a.id === alert_id)
    if (!alert) return notFound('Alerta no encontrada')
    if (!alert.resolved_at) alert.resolved_at = new Date().toISOString()
    return alert
  },

  // ---------- Telegram ----------
  getTelegramStatus: async () => { await delay(150); return store.telegram },
  getTelegramLinkToken: async () => {
    await delay()
    return {
      token: 'MOCK42', expires_in_seconds: 300, bot_username: 'totem_demo_bot',
      instructions: 'Abre @totem_demo_bot en Telegram y escribe: /vincular MOCK42',
    }
  },
  deleteTelegramLink: async () => {
    await delay()
    store.telegram = { linked: false, linked_at: null }
    return null
  },

  // ---------- Crop profiles ----------
  getIrrigationMethods: async () => { await delay(); return store.irrigationMethods },
  getProfiles: async (organization_id) => {
    await delay()
    return store.profiles.filter(p => p.organization_id === organization_id)
  },
  createProfile: async (body) => {
    await delay()
    try {
      validateIrrigationMethod(body.irrigation_method, body.irrigation_params)
    } catch (err) {
      return notFound(err.message)
    }
    const now = new Date().toISOString()
    const profile = { id: uid(), created_at: now, updated_at: now, ...body }
    store.profiles.push(profile)
    return profile
  },
  updateProfile: async (id, body) => {
    await delay()
    const idx = store.profiles.findIndex(p => p.id === id)
    if (idx === -1) return notFound('Perfil no encontrado')
    try {
      validateIrrigationMethod(body.irrigation_method, body.irrigation_params)
    } catch (err) {
      return notFound(err.message)
    }
    store.profiles[idx] = { ...store.profiles[idx], ...body, updated_at: new Date().toISOString() }
    return store.profiles[idx]
  },
  deleteProfile: async (id) => {
    await delay()
    const assigned = store.units.filter(u => u.active_profile_id === id)
    if (assigned.length > 0) {
      const names = assigned.map(u => u.name).join(', ')
      return notFound(`El perfil está asignado a las unidades: ${names}. Quítalo de esas unidades antes de eliminarlo.`)
    }
    store.profiles = store.profiles.filter(p => p.id !== id)
    return null
  },
  assignProfile: async (unit_id, profile_id) => {
    await delay()
    const unit = store.units.find(u => u.id === unit_id)
    if (!unit) return notFound('Unidad no encontrada')
    if (profile_id == null) {
      unit.active_profile_id = null
      return { detail: 'Perfil quitado' }
    }
    const profile = store.profiles.find(p => p.id === profile_id)
    if (!profile) return notFound('Perfil no encontrado')

    // Compatibilidad perfil ↔ firmware objetivo de la unidad, igual que el
    // check del server (routers/units.py assign_profile).
    if (unit.target_firmware_release_id) {
      const release = store.firmwareReleases.find(r => r.id === unit.target_firmware_release_id)
      if (release && !release.supported_irrigation_methods.includes(profile.irrigation_method)) {
        return notFound(
          `El firmware objetivo de esta unidad (v${release.version}) no soporta el método de riego '${profile.irrigation_method}' de este perfil`
        )
      }
    }

    unit.active_profile_id = profile_id
    return { detail: 'Perfil asignado' }
  },

  // ---------- Firmware ----------
  getFirmwareReleases: async (organization_id) => {
    await delay()
    return store.firmwareReleases
      .filter(r => r.organization_id === organization_id)
      .sort((a, b) => new Date(b.released_at) - new Date(a.released_at))
  },
  uploadFirmware: async ({ organization_id, description, supported_irrigation_methods }) => {
    await delay(400)
    const methods = supported_irrigation_methods ?? []
    const unknown = methods.filter(key => !store.irrigationMethods.some(m => m.key === key))
    if (unknown.length > 0) {
      return notFound(`Métodos de riego desconocidos: ${unknown.join(', ')}`)
    }
    // En real, la versión se lee del binario subido — el mock no tiene un
    // binario real que parsear, así que simula el mismo efecto incrementando
    // el patch de la última versión publicada en la organización.
    const orgReleases = store.firmwareReleases.filter(r => r.organization_id === organization_id)
    let version = '1.0.0'
    if (orgReleases.length > 0) {
      const latest = [...orgReleases].sort((a, b) => new Date(b.released_at) - new Date(a.released_at))[0]
      const parts = latest.version.split('.').map(Number)
      parts[2] = (parts[2] || 0) + 1
      version = parts.join('.')
    }
    const release = {
      id: uid(), organization_id, version, description: description || null,
      sha256: Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
      uploaded_by: 'user-demo', released_at: new Date().toISOString(), download_url: '#',
      supported_irrigation_methods: methods,
    }
    store.firmwareReleases.push(release)
    return release
  },
  deployFirmware: async (release_id, target) => {
    await delay(300)
    const release = store.firmwareReleases.find(r => r.id === release_id)
    if (!release) return notFound('Release no encontrado')

    // Mismo check de compatibilidad que el server: bloquea si la unidad (o
    // alguna del lote, para despliegue por organización) tiene un perfil
    // activo cuyo método no soporta este release.
    const incompatible = (unit) => {
      if (!unit.active_profile_id) return null
      const profile = store.profiles.find(p => p.id === unit.active_profile_id)
      if (!profile) return null
      return release.supported_irrigation_methods.includes(profile.irrigation_method) ? null : profile.irrigation_method
    }

    if (target.unit_id) {
      const unit = store.units.find(u => u.id === target.unit_id)
      if (!unit) return notFound('Unidad no encontrada')
      const conflict = incompatible(unit)
      if (conflict) {
        return notFound(`La unidad tiene activo un perfil '${conflict}' que el firmware v${release.version} no soporta`)
      }
      unit.target_firmware_release_id = release.id
      return { detail: `Firmware ${release.version} aplicado a unidad ${unit.name}`, version: release.version }
    }

    const units = store.units.filter(
      u => u.organization_id === target.organization_id && u.type === 'totem' && u.is_active
    )
    const conflicts = units
      .map(u => ({ unit: u, conflict: incompatible(u) }))
      .filter(x => x.conflict)
    if (conflicts.length > 0) {
      const detail = conflicts.map(x => `${x.unit.name} (perfil '${x.conflict}')`).join('; ')
      return notFound(`El firmware v${release.version} no soporta el método de riego de: ${detail}`)
    }

    units.forEach(u => { u.target_firmware_release_id = release.id })
    return {
      detail: `Firmware ${release.version} aplicado a ${units.length} unidades`,
      version: release.version, units: units.map(u => u.id),
    }
  },
  deleteFirmware: async (release_id) => {
    await delay()
    const idx = store.firmwareReleases.findIndex(r => r.id === release_id)
    if (idx === -1) return notFound('Release no encontrado')
    store.firmwareReleases.splice(idx, 1)
    store.units.forEach(u => {
      if (u.target_firmware_release_id === release_id) u.target_firmware_release_id = null
    })
    return null
  },
}

// Helper de desarrollo: genera más lecturas para una unidad desde la consola
// del navegador, ej. window.__totemMocks.genReadings(48, 10)
if (typeof window !== 'undefined') {
  window.__totemMocks = { store, genReadings }
}
