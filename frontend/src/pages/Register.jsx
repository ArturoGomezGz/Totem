import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../api'
import { s } from './styles'

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
      navigate('/login')
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
        <h2 style={s.title}>Crear cuenta</h2>
        <input style={s.input} type="email"    placeholder="Email"      value={email}    onChange={e => setEmail(e.target.value)}    required />
        <input style={s.input} type="password" placeholder="Contraseña" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
        {error && <p style={s.error}>{error}</p>}
        <button style={s.btn} type="submit" disabled={loading}>
          {loading ? 'Creando...' : 'Crear cuenta'}
        </button>
        <p style={s.link}>¿Ya tienes cuenta? <Link to="/login" style={s.a}>Inicia sesión</Link></p>
      </form>
    </div>
  )
}
