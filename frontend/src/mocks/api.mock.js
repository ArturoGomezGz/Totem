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
  getUnitState: async (unit_id) => {
    await delay(100)
    const live = store.liveState[unit_id]
    if (!live) return notFound('Unidad no encontrada o sin datos aun')
    return live
  },

  // ---------- Commands ----------
  sendCommand: async (unit_id, type) => {
    await delay(200)
    const pump_on = type === 'pump_on'
    setLiveState(unit_id, { pump_on, last_seen: new Date().toISOString() })
    store.events.unshift({ id: uid(), unit_id, timestamp: new Date().toISOString(), type, trigger: 'manual' })
    return { detail: 'Comando enviado' }
  },

  // ---------- Readings / Events ----------
  getReadings: async (unit_id, params = {}) => {
    await delay()
    const rows = store.readings[unit_id] ?? []
    const limit = params.limit ?? 500
    return rows.slice(0, limit)
  },
  getEvents: async (unit_id, params = {}) => {
    await delay()
    const rows = store.events.filter(e => e.unit_id === unit_id)
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
  getProfiles: async (organization_id) => {
    await delay()
    return store.profiles.filter(p => p.organization_id === organization_id)
  },
  createProfile: async (body) => {
    await delay()
    const now = new Date().toISOString()
    const profile = { id: uid(), created_at: now, updated_at: now, ...body }
    store.profiles.push(profile)
    return profile
  },
  updateProfile: async (id, body) => {
    await delay()
    const idx = store.profiles.findIndex(p => p.id === id)
    if (idx === -1) return notFound('Perfil no encontrado')
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
    unit.active_profile_id = profile_id
    return { detail: 'Perfil asignado' }
  },
}

// Helper de desarrollo: genera más lecturas para una unidad desde la consola
// del navegador, ej. window.__totemMocks.genReadings(48, 10)
if (typeof window !== 'undefined') {
  window.__totemMocks = { store, genReadings }
}
