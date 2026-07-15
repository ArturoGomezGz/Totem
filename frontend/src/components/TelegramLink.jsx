import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { Button, Alert, Badge } from '../design-system'
import { copyToClipboard } from '../utils/clipboard'

const COUNTDOWN_SECONDS = 300

export default function TelegramLink() {
  const { t }                     = useTranslation()
  const [status, setStatus]       = useState(null)
  const [token, setToken]         = useState(null)
  const [countdown, setCountdown] = useState(0)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [copied, setCopied]       = useState(false)

  const loadStatus = async () => {
    try { setStatus(await api.getTelegramStatus()) } catch { /* silencioso */ }
  }

  useEffect(() => { loadStatus() }, [])

  useEffect(() => {
    if (!token) return
    setCountdown(COUNTDOWN_SECONDS)
    const interval = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(interval); setToken(null); return 0 }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [token])

  const generateToken = async () => {
    setLoading(true)
    setError(null)
    try {
      setToken(await api.getTelegramLinkToken())
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

  const copyCommand = () => {
    if (!token?.token) return
    copyToClipboard(`/vincular ${token.token}`).then(ok => {
      if (ok) {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    })
  }

  if (!status) return null

  return (
    <div>
      <h3 style={{
        fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
        fontSize: 'var(--text-base)', color: 'var(--text-strong)',
        marginBottom: 'var(--space-4)',
      }}>
        {t('telegramLink.title')}
      </h3>

      {status.linked ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <Badge tone="success">{t('telegramLink.linked')}</Badge>
            {status.linked_at && (
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                {t('telegramLink.linkedSince', { date: new Date(status.linked_at).toLocaleDateString('es-MX') })}
              </span>
            )}
          </div>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
            {t('telegramLink.linkedMessage')}
          </p>
          <Button variant="outline" size="sm" onClick={unlink} disabled={loading}>
            {loading ? t('telegramLink.unlinking') : t('telegramLink.unlink')}
          </Button>
        </div>
      ) : (
        <div>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
            {t('telegramLink.unlinkedMessage')}
          </p>

          {!token ? (
            <Button variant="primary" onClick={generateToken} disabled={loading}>
              {loading ? t('telegramLink.generating') : t('telegramLink.linkButton')}
            </Button>
          ) : (
            <div style={{
              background: 'var(--blue-050)', border: '1px solid var(--blue-100)',
              borderRadius: 'var(--radius-md)', padding: 'var(--space-5)',
              display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{
                  fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
                  fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
                }}>
                  {t('telegramLink.tokenLabel')}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
                  color: countdown < 60 ? 'var(--status-danger)' : 'var(--text-muted)',
                }}>
                  {countdown}s
                </span>
              </div>

              <span style={{
                fontFamily: 'var(--font-mono)', fontWeight: 'var(--weight-bold)',
                fontSize: 'var(--text-xl)', color: 'var(--blue-900)',
                letterSpacing: '0.15em',
              }}>
                {token.token}
              </span>

              <div style={{ borderTop: '1px solid var(--blue-100)', paddingTop: 'var(--space-4)' }}>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-body)', marginBottom: 'var(--space-2)' }}>
                  {t('telegramLink.openBot')}{' '}
                  {token.bot_username
                    ? <a href={`https://t.me/${token.bot_username}`} target="_blank" rel="noreferrer" style={{ color: 'var(--blue-700)', fontWeight: 'var(--weight-semibold)' }}>@{token.bot_username}</a>
                    : t('telegramLink.theBot')
                  }{' '}
                  {t('telegramLink.openBotSuffix')}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <code style={{
                    display: 'block', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
                    background: 'var(--white)', border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)', padding: 'var(--space-3)',
                    color: 'var(--blue-900)', letterSpacing: '0.05em', flex: 1,
                  }}>
                    /vincular {token.token}
                  </code>
                  <Button size="sm" variant="outline" onClick={copyCommand}>{copied ? t('common.copied') : t('common.copy')}</Button>
                </div>
              </div>

              <Button variant="ghost" size="sm" onClick={() => setToken(null)} style={{ alignSelf: 'flex-start' }}>
                {t('telegramLink.cancel')}
              </Button>
            </div>
          )}
        </div>
      )}

      {error && <Alert tone="danger" style={{ marginTop: 'var(--space-3)' }}>{error}</Alert>}
    </div>
  )
}
