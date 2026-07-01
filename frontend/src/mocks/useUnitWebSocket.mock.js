// Reemplazo mock de hooks/useUnitWebSocket.js — misma forma de retorno,
// pero lee del store en memoria en vez de abrir un WebSocket real.

import { useState, useEffect } from 'react'
import { store, subscribeUnit } from './store'

const OFFLINE_MS = 35000
const CONNECT_DELAY_MS = 300 // simula el handshake inicial del WS real

export function useUnitWebSocketMock(unitId) {
  const [unit, setUnit] = useState(store.liveState[unitId] ?? null)
  const [wsConnected, setWsConnected] = useState(false)

  useEffect(() => {
    setUnit(store.liveState[unitId] ?? null)
    setWsConnected(false)

    const connectTimer = setTimeout(() => setWsConnected(true), CONNECT_DELAY_MS)
    const unsubscribe = subscribeUnit(unitId, (next) => setUnit(next))

    return () => {
      clearTimeout(connectTimer)
      unsubscribe()
    }
  }, [unitId])

  const isOffline = !unit?.last_seen ||
    Date.now() - new Date(unit.last_seen).getTime() > OFFLINE_MS

  return { unit, wsConnected, isOffline, error: null }
}
