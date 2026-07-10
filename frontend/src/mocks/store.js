// Estado en memoria compartido entre api.mock.js y useUnitWebSocket.mock.js.
// Vive mientras dure la pestaña — un refresh del navegador lo resetea a las
// fixtures originales (a propósito: cada prueba de flujo empieza limpia).

import {
  seedOrganizations, seedUnits, seedProfiles,
  seedAlerts, seedEvents, seedReadings, seedLiveState,
  seedFirmwareReleases, seedMembers, seedIrrigationMethods,
} from './fixtures'

export const store = {
  organizations: seedOrganizations(),
  units: seedUnits(),
  profiles: seedProfiles(),
  alerts: seedAlerts(),
  events: seedEvents(),
  readings: seedReadings(),
  liveState: seedLiveState(),
  telegram: { linked: false, linked_at: null },
  firmwareReleases: seedFirmwareReleases(),
  members: seedMembers(),
  irrigationMethods: seedIrrigationMethods(),
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
if (import.meta.env.VITE_USE_MOCKS === 'true') {
  // "unit-totem-1" es la única unidad que recibe lecturas en vivo de forma
  // continua — simula el ESP32 conectado. Las demás se quedan estáticas para
  // poder probar los estados "esperando datos" y "sin señal" sin código extra.
  setInterval(() => {
    const current = store.liveState['unit-totem-1']
    if (!current) return
    const r = current.readings
    setLiveState('unit-totem-1', {
      last_seen: new Date().toISOString(),
      readings: {
        ...r,
        temperature: Math.round((r.temperature + (Math.random() - 0.5) * 1.0) * 10) / 10,
        humidity: Math.round((r.humidity + (Math.random() - 0.5) * 2) * 10) / 10,
        timestamp: new Date().toISOString(),
      },
    })
  }, 4000)
}
