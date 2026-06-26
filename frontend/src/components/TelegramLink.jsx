import { useState, useEffect } from 'react'
import { api } from '../api'
import { s } from '../pages/styles'

const COUNTDOWN_SECONDS = 300

export default function TelegramLink() {
  const [status, setStatus]       = useState(null)   // null | { linked, chat_id, linked_at }
  const [token, setToken]         = useState(null)   // null | { token, instructions, bot_username }
  const [countdown, setCountdown] = useState(0)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)

  const loadStatus = async () => {
    try {
      setStatus(await api.getTelegramStatus())
    } catch {
      // silencioso — no bloquea el resto de la página
    }
  }

  useEffect(() => { loadStatus() }, [])

  // Countdown del token
  useEffect(() => {
    if (!token) return
    setCountdown(COUNTDOWN_SECONDS)
    const interval = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(interval)
          setToken(null)
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [token])

  const generateToken = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.getTelegramLinkToken()
      setToken(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const unlink = async () => {
    setLoading(true)
    setError(null)
    try {
      await api.deleteTelegramLink()
      setStatus({ linked: false })
      setToken(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const copyToken = () => {
    if (token?.token) navigator.clipboard.writeText(token.token)
  }

  if (!status) return null

  return (
    <div style={{ marginTop: '40px' }}>
      <div style={{ borderTop: '1px solid #2a2a2a', paddingTop: '24px' }}>
        <h3 style={{ ...s.title, fontSize: '14px', marginBottom: '8px' }}>
          Notificaciones Telegram
        </h3>

        {status.linked ? (
          <div>
            <div style={styles.statusRow}>
              <span style={styles.linked}>Vinculado</span>
              {status.linked_at && (
                <span style={s.timestamp}>
                  desde {new Date(status.linked_at).toLocaleDateString('es-MX')}
                </span>
              )}
            </div>
            <p style={{ ...s.muted, marginBottom: '12px' }}>
              Recibirás alertas de tus organizaciones en Telegram.
            </p>
            <button style={styles.btnDanger} onClick={unlink} disabled={loading}>
              {loading ? 'Desvinculando...' : 'Desvincular'}
            </button>
          </div>
        ) : (
          <div>
            <p style={{ ...s.muted, marginBottom: '12px' }}>
              Vincula tu cuenta para recibir alertas directamente en Telegram.
            </p>

            {!token ? (
              <button style={s.btn} onClick={generateToken} disabled={loading}>
                {loading ? 'Generando...' : 'Vincular Telegram'}
              </button>
            ) : (
              <div style={styles.tokenBox}>
                <div style={styles.tokenRow}>
                  <span style={styles.tokenLabel}>Tu token de vinculación</span>
                  <span style={styles.countdown}>{countdown}s</span>
                </div>

                <div style={styles.tokenValueRow}>
                  <span style={styles.tokenValue}>{token.token}</span>
                  <button style={styles.copyBtn} onClick={copyToken}>Copiar</button>
                </div>

                <div style={styles.divider} />

                <p style={styles.instruction}>
                  Abre{' '}
                  {token.bot_username
                    ? <a href={`https://t.me/${token.bot_username}`} target="_blank" rel="noreferrer" style={s.a}>@{token.bot_username}</a>
                    : 'el bot'
                  }{' '}
                  en Telegram y escribe:
                </p>
                <code style={styles.command}>/vincular {token.token}</code>

                <button
                  style={{ ...styles.btnGhostSm, marginTop: '12px' }}
                  onClick={() => setToken(null)}
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>
        )}

        {error && <p style={{ ...s.error, marginTop: '8px' }}>{error}</p>}
      </div>
    </div>
  )
}

const styles = {
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '6px',
  },
  linked: {
    background: '#1a2e1a',
    color: '#27ae60',
    fontSize: '12px',
    fontWeight: '600',
    padding: '3px 10px',
    borderRadius: '20px',
    border: '1px solid #27ae60',
  },
  btnDanger: {
    background: 'transparent',
    border: '1px solid #555',
    borderRadius: '8px',
    color: '#888',
    padding: '8px 16px',
    fontSize: '13px',
    cursor: 'pointer',
  },
  tokenBox: {
    background: '#1a1a2e',
    border: '1px solid #3a3a6e',
    borderRadius: '12px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  tokenRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tokenLabel: {
    fontSize: '11px',
    color: '#888',
    letterSpacing: '1px',
    textTransform: 'uppercase',
  },
  countdown: {
    fontSize: '12px',
    color: '#e74c3c',
    fontVariantNumeric: 'tabular-nums',
  },
  tokenValueRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  tokenValue: {
    fontSize: '28px',
    fontWeight: '700',
    letterSpacing: '8px',
    color: '#fff',
    fontFamily: 'monospace',
    flex: 1,
  },
  copyBtn: {
    background: '#1e1e3e',
    border: '1px solid #3a3a6e',
    borderRadius: '6px',
    color: '#aaa',
    padding: '6px 12px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  divider: {
    borderTop: '1px solid #2a2a4a',
    margin: '4px 0',
  },
  instruction: {
    margin: 0,
    fontSize: '13px',
    color: '#aaa',
  },
  command: {
    display: 'block',
    background: '#111',
    borderRadius: '6px',
    padding: '8px 12px',
    fontSize: '14px',
    color: '#27ae60',
    fontFamily: 'monospace',
    letterSpacing: '1px',
  },
  btnGhostSm: {
    background: 'transparent',
    border: 'none',
    color: '#555',
    fontSize: '12px',
    cursor: 'pointer',
    padding: 0,
    textAlign: 'left',
  },
}
