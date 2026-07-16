// Estado en memoria compartido entre api.mock.js y useUnitWebSocket.mock.js.
// Vive mientras dure la pestaña — un refresh del navegador lo resetea a las
// fixtures originales (a propósito: cada prueba de flujo empieza limpia).

import {
  seedOrganizations, seedUnits, seedProfiles,
  seedAlerts, seedEvents, seedReadings, seedLiveState,
  seedFirmwareReleases, seedMembers, seedIrrigationMethods,
  seedMaintenance,
} from './fixtures'

const seededUnits       = seedUnits()
const seededMaintenance = seedMaintenance()

// Las ventanas abiertas viven en dos lugares (unit.maintenance y el historial
// por unidad) igual que en el server, donde UnitOut.maintenance y
// GET /maintenance salen de la misma fila. Aquí se comparte la referencia para
// que cerrar una ventana desde la UI se refleje en ambas.
for (const unit of seededUnits) {
  if (unit.maintenance) {
    seededMaintenance[unit.id] = [unit.maintenance, ...(seededMaintenance[unit.id] ?? [])]
  } else {
    unit.maintenance = null
  }
}

export const store = {
  organizations: seedOrganizations(),
  units: seededUnits,
  profiles: seedProfiles(),
  alerts: seedAlerts(),
  events: seedEvents(),
  readings: seedReadings(),
  liveState: seedLiveState(),
  telegram: { linked: false, linked_at: null },
  firmwareReleases: seedFirmwareReleases(),
  members: seedMembers(),
  irrigationMethods: seedIrrigationMethods(),
  // Usuario "logueado" en el entorno de mocks — el mock de login acepta
  // cualquier credencial, así que se fija aquí para poder atribuir acciones
  // (quién abrió una ventana de mantenimiento).
  currentUser: { id: 'user-demo', email: 'admin@demo.com' },
  maintenance: seededMaintenance, // unit_id -> ventanas, más reciente primero
}

const listeners = {} // unit_id -> Set<fn>

export function subscribeUnit(unitId, fn) {
  if (!listeners[unitId]) listeners[unitId] = new Set()
  listeners[unitId].add(fn)
  return () => listeners[unitId].delete(fn)
}

function notify(unitId) {
  listeners[unitId]?.forEach(fn => fn(store.liveState[unitId] ?? null))
}

export function setLiveState(unitId, patch) {
  store.liveState[unitId] = { ...store.liveState[unitId], ...patch }
  notify(unitId)
}

// Solo se activa en modo mock: el import de este módulo ocurre siempre
// (import estático), pero el intervalo real no debe correr en modo normal.
// Unidades que simulan un ESP32 conectado: reciben lecturas nuevas de forma
// continua. Sin heartbeat, `last_seen` se congela en el arranque y la unidad
// aparece "sin señal" a los 35 s (OFFLINE_MS) — lo que dejaba media vista
// general en gris al poco de abrirla.
//
// Fuera de esta lista a propósito: 'unit-totem-2' (registrada, nunca reportó),
// 'unit-totem-6' (perdió señal hace 6 h) y 'unit-tank-1' (última señal hace
// 2 min). Son los tres estados que la UI debe saber dibujar.
const HEARTBEAT_UNITS = ['unit-totem-1', 'unit-totem-3', 'unit-totem-4', 'unit-totem-5']

// Deriva el siguiente valor manteniendo null si la unidad no monta ese sensor.
const drift = (v, amp) =>
  v == null ? null : Math.round((v + (Math.random() - 0.5) * amp) * 10) / 10

// Solo se activa en modo mock: el import de este módulo ocurre siempre
// (import estático), pero el intervalo real no debe correr en modo normal.
if (import.meta.env.VITE_USE_MOCKS === 'true') {
  setInterval(() => {
    const now = new Date().toISOString()
    for (const unitId of HEARTBEAT_UNITS) {
      const current = store.liveState[unitId]
      if (!current) continue
      const r = current.readings
      setLiveState(unitId, {
        last_seen: now,
        readings: {
          ...r,
          temperature: drift(r.temperature, 1.0),
          humidity:    drift(r.humidity, 2),
          light:       drift(r.light, 30),
          air_quality: drift(r.air_quality, 20),
          methane:     drift(r.methane, 30),
          co2:         drift(r.co2, 80),
          timestamp: now,
        },
      })
    }
  }, 4000)
}
