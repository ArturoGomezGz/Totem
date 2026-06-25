import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api, saveTokens } from '../api'
import { s } from './styles'

export default function Login() {
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
      const data = await api.login(email, password)
      saveTokens(data.access_token, data.refresh_token)
      navigate('/organizations')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.page}>
      <h1 style={s.logo}>TOTEM</h1>
      <form style={s.form} onSubmit={submit}>
        <h2 style={s.title}>Iniciar sesión</h2>
        <input style={s.input} type="email"    placeholder="Email"      value={email}    onChange={e => setEmail(e.target.value)}    required />
        <input style={s.input} type="password" placeholder="Contraseña" value={password} onChange={e => setPassword(e.target.value)} required />
        {error && <p style={s.error}>{error}</p>}
        <button style={s.btn} type="submit" disabled={loading}>
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
        <p style={s.link}>¿No tienes cuenta? <Link to="/register" style={s.a}>Regístrate</Link></p>
      </form>
    </div>
  )
}
