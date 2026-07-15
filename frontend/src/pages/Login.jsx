import { useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, saveTokens } from '../api'
import { Button, Input, Alert } from '../design-system'
export default function Login() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState(null)
  const [info, setInfo]         = useState(location.state?.info ?? null)
  const [loading, setLoading]   = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setInfo(null)
    try {
      const data = await api.login(email, password)
      saveTokens(data.access_token, data.refresh_token)
      navigate('/units', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--surface-sunken)',
      padding: 'var(--space-4)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        background: 'var(--surface-card)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        padding: 'var(--space-7) var(--space-6)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-7)' }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 'var(--weight-extrabold)',
            fontSize: 'var(--text-2xl)',
            color: 'var(--blue-900)',
            letterSpacing: 'var(--tracking-caps)',
            display: 'block',
          }}>
            {t('common.appName')}
          </span>
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
            marginTop: 'var(--space-1)',
            display: 'block',
          }}>
            {t('common.tagline')}
          </span>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 'var(--weight-semibold)',
            fontSize: 'var(--text-lg)',
            color: 'var(--text-strong)',
            marginBottom: 'var(--space-1)',
          }}>
            {t('auth.login.heading')}
          </h1>

          {info && <Alert tone="success" onClose={() => setInfo(null)}>{info}</Alert>}
          {error && <Alert tone="danger" onClose={() => setError(null)}>{error}</Alert>}

          <Input
            label={t('auth.login.email')}
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <Input
            label={t('auth.login.password')}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          <Button type="submit" fullWidth disabled={loading} style={{ marginTop: 'var(--space-2)' }}>
            {loading ? t('auth.login.submitting') : t('auth.login.submit')}
          </Button>

          <p style={{ textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            {t('auth.login.noAccount')}{' '}
            <Link to="/register" style={{ color: 'var(--blue-700)', fontWeight: 'var(--weight-semibold)' }}>
              {t('auth.login.registerLink')}
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
