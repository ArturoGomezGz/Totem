import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api, saveTokens } from '../api'
import { Button, Input, Alert } from '../design-system'

export default function Register() {
  const navigate = useNavigate()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState(null)
  const [loading, setLoading]   = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await api.register(email, password)
      try {
        const data = await api.login(email, password)
        saveTokens(data.access_token, data.refresh_token)
        navigate('/units', { replace: true })
      } catch (loginErr) {
        // La cuenta se creó correctamente pero el login automático falló;
        // avisamos al usuario para que no interprete el salto como un error.
        navigate('/login', { state: { info: 'Tu cuenta se creó correctamente. Inicia sesión para continuar.' } })
      }
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
            TOTEM
          </span>
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
            marginTop: 'var(--space-1)',
            display: 'block',
          }}>
            Sistema aeropónico modular
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
            Crear cuenta
          </h1>

          {error && <Alert tone="danger" onClose={() => setError(null)}>{error}</Alert>}

          <Input
            label="Correo electrónico"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <Input
            label="Contraseña"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            hint="Mínimo 8 caracteres"
            required
          />

          <Button type="submit" fullWidth disabled={loading} style={{ marginTop: 'var(--space-2)' }}>
            {loading ? 'Creando cuenta...' : 'Crear cuenta'}
          </Button>

          <p style={{ textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            ¿Ya tienes cuenta?{' '}
            <Link to="/login" style={{ color: 'var(--blue-700)', fontWeight: 'var(--weight-semibold)' }}>
              Inicia sesión
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
