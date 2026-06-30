import { useState, useEffect, useRef } from 'react'

const OFFLINE_MS = 35000
const WS_RECONNECT_MS = 3000

export function useUnitWebSocket(unitId) {
  const [unit, setUnit] = useState(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [error, setError] = useState(null)

  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    const connect = () => {
      if (!mountedRef.current) return
      const token = localStorage.getItem('access_token')
      if (!token) return

      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${window.location.host}/ws/units/${unitId}?token=${token}`)
      wsRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current) return
        setWsConnected(true)
        setError(null)
      }

      ws.onmessage = (e) => {
        if (!mountedRef.current) return
        try {
          const data = JSON.parse(e.data)
          if (data.type === 'state') {
            const { type: _, ...unitState } = data
            setUnit(unitState)
          }
        } catch { /* ignorar mensajes malformados */ }
      }

      ws.onerror = () => setWsConnected(false)

      ws.onclose = () => {
        if (!mountedRef.current) return
        setWsConnected(false)
        reconnectTimer.current = setTimeout(connect, WS_RECONNECT_MS)
      }
    }

    connect()

    return () => {
      mountedRef.current = false
      if (wsRef.current) wsRef.current.close()
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [unitId])

  const isOffline = !unit?.last_seen ||
    Date.now() - new Date(unit.last_seen).getTime() > OFFLINE_MS

  return { unit, wsConnected, isOffline, error }
}
