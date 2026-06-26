import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, clearTokens } from '../api'
import { s } from './styles'
import TelegramLink from '../components/TelegramLink'

export default function Organizations() {
  const navigate = useNavigate()
  const [orgs, setOrgs]       = useState([])
  const [name, setName]       = useState('')
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    try {
      setOrgs(await api.getOrganizations())
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { load() }, [])

  const create = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await api.createOrganization(name)
      setName('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    const refresh_token = localStorage.getItem('refresh_token')
    if (refresh_token) {
      try { await api.logout(refresh_token) } catch { /* silencioso */ }
    }
    clearTokens()
    navigate('/login')
  }

  return (
    <div style={s.page}>
      <header style={s.header}>
        <span style={s.logo}>TOTEM</span>
        <button style={s.btnGhost} onClick={logout}>Salir</button>
      </header>

      <div style={s.container}>
        <h2 style={s.title}>Mis organizaciones</h2>

        {orgs.length === 0 && !error && (
          <p style={s.muted}>No tienes organizaciones aún.</p>
        )}

        {orgs.map(org => (
          <div key={org.id} style={s.card}>
            <div>
              <p style={s.cardTitle}>{org.name}</p>
              <p style={s.cardSub}>{org.role}</p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button style={s.btnSm} onClick={() => navigate(`/organizations/${org.id}/profiles`)}>
                Perfiles
              </button>
              <button style={s.btnSm} onClick={() => navigate(`/organizations/${org.id}/units`)}>
                Entrar
              </button>
            </div>
          </div>
        ))}

        {error && <p style={s.error}>{error}</p>}

        <form style={{ ...s.form, marginTop: '32px' }} onSubmit={create}>
          <h3 style={{ ...s.title, fontSize: '14px' }}>Nueva organización</h3>
          <input style={s.input} placeholder="Nombre" value={name} onChange={e => setName(e.target.value)} required />
          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? 'Creando...' : 'Crear'}
          </button>
        </form>

        <TelegramLink />
      </div>
    </div>
  )
}
