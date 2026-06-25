import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { s } from './styles'

export default function Units() {
  const { orgId } = useParams()
  const navigate  = useNavigate()

  const [units, setUnits]       = useState([])
  const [name, setName]         = useState('')
  const [type, setType]         = useState('totem')
  const [error, setError]       = useState(null)
  const [loading, setLoading]   = useState(false)
  const [newUnit, setNewUnit]   = useState(null)

  const load = async () => {
    try {
      setUnits(await api.getUnits(orgId))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { load() }, [orgId])

  const create = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const created = await api.createUnit({ organization_id: orgId, type, name })
      setNewUnit(created)
      setName('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.page}>
      <header style={s.header}>
        <button style={s.btnGhost} onClick={() => navigate('/organizations')}>← Volver</button>
        <span style={s.logo}>TOTEM</span>
      </header>

      <div style={s.container}>
        <h2 style={s.title}>Unidades</h2>

        {units.length === 0 && !error && (
          <p style={s.muted}>No hay unidades registradas.</p>
        )}

        {units.map(unit => (
          <div key={unit.id} style={s.card}>
            <div>
              <p style={s.cardTitle}>{unit.name}</p>
              <p style={s.cardSub}>{unit.type} · {unit.is_active ? 'activa' : 'inactiva'}</p>
            </div>
            <button style={s.btnSm} onClick={() => navigate(`/organizations/${orgId}/units/${unit.id}`)}>
              Ver
            </button>
          </div>
        ))}

        {error && <p style={s.error}>{error}</p>}

        {newUnit && (
          <div style={s.apiKeyBox}>
            <p style={s.cardTitle}>Unidad creada — guarda la API Key</p>
            <p style={s.muted}>Solo se muestra una vez. Flashéala en el dispositivo.</p>
            <code style={s.apiKey}>{newUnit.api_key}</code>
            <button style={{ ...s.btnSm, marginTop: '12px' }} onClick={() => setNewUnit(null)}>
              Entendido
            </button>
          </div>
        )}

        <form style={{ ...s.form, marginTop: '32px' }} onSubmit={create}>
          <h3 style={{ ...s.title, fontSize: '14px' }}>Registrar unidad</h3>
          <input style={s.input} placeholder="Nombre" value={name} onChange={e => setName(e.target.value)} required />
          <select style={s.input} value={type} onChange={e => setType(e.target.value)}>
            <option value="totem">Totem</option>
            <option value="supply_tank">Tanque de suministro</option>
          </select>
          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? 'Registrando...' : 'Registrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
