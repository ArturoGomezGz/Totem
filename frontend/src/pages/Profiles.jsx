import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { s } from './styles'

const PLACEHOLDER_PARAMS = `{
  "threshold_pn": 8.5,
  "cycle_duration_s": 30,
  "min_interval_s": 900
}`

const EMPTY_FORM = {
  name: '',
  species: '',
  temp_min: '',
  temp_max: '',
  humidity_min: '',
  humidity_max: '',
  light_min: '',
  light_max: '',
  co2_min: '',
  co2_max: '',
  irrigation_method: '',
  irrigation_params: '',
}

function toFloat(val) {
  const n = parseFloat(val)
  return isNaN(n) ? null : n
}

function profileToForm(p) {
  return {
    name: p.name ?? '',
    species: p.species ?? '',
    temp_min: p.temp_min != null ? String(p.temp_min) : '',
    temp_max: p.temp_max != null ? String(p.temp_max) : '',
    humidity_min: p.humidity_min != null ? String(p.humidity_min) : '',
    humidity_max: p.humidity_max != null ? String(p.humidity_max) : '',
    light_min: p.light_min != null ? String(p.light_min) : '',
    light_max: p.light_max != null ? String(p.light_max) : '',
    co2_min: p.co2_min != null ? String(p.co2_min) : '',
    co2_max: p.co2_max != null ? String(p.co2_max) : '',
    irrigation_method: p.irrigation_method ?? '',
    irrigation_params: JSON.stringify(p.irrigation_params, null, 2),
  }
}

export default function Profiles() {
  const { orgId }   = useParams()
  const navigate    = useNavigate()

  const [profiles, setProfiles]     = useState([])
  const [form, setForm]             = useState(EMPTY_FORM)
  const [editingId, setEditingId]   = useState(null)
  const [error, setError]           = useState(null)
  const [formError, setFormError]   = useState(null)
  const [loading, setLoading]       = useState(false)

  const load = async () => {
    try {
      setProfiles(await api.getProfiles(orgId))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { load() }, [orgId])

  const handleChange = (field) => (e) => {
    setForm(f => ({ ...f, [field]: e.target.value }))
  }

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setFormError(null)
  }

  const handleEdit = (profile) => {
    setEditingId(profile.id)
    setForm(profileToForm(profile))
    setFormError(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError(null)

    let irrigation_params
    try {
      irrigation_params = JSON.parse(form.irrigation_params)
    } catch {
      setFormError('irrigation_params debe ser JSON válido')
      return
    }

    const body = {
      organization_id: orgId,
      name: form.name,
      species: form.species || null,
      temp_min: toFloat(form.temp_min),
      temp_max: toFloat(form.temp_max),
      humidity_min: toFloat(form.humidity_min),
      humidity_max: toFloat(form.humidity_max),
      light_min: toFloat(form.light_min),
      light_max: toFloat(form.light_max),
      co2_min: toFloat(form.co2_min),
      co2_max: toFloat(form.co2_max),
      irrigation_method: form.irrigation_method,
      irrigation_params,
    }

    setLoading(true)
    try {
      if (editingId) {
        await api.updateProfile(editingId, body)
      } else {
        await api.createProfile(body)
      }
      resetForm()
      await load()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (profile) => {
    setError(null)
    try {
      await api.deleteProfile(profile.id)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div style={s.page}>
      <header style={s.header}>
        <button style={s.btnGhost} onClick={() => navigate('/organizations')}>← Volver</button>
        <span style={s.logo}>TOTEM</span>
        <span style={{ width: '60px' }} />
      </header>

      <div style={s.container}>
        <h2 style={s.title}>Perfiles de cultivo</h2>

        {error && <p style={s.error}>{error}</p>}

        {profiles.length === 0 && !error && (
          <p style={s.muted}>No hay perfiles en esta organización.</p>
        )}

        {profiles.map(profile => (
          <div key={profile.id} style={s.card}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={s.cardTitle}>{profile.name}</p>
              <p style={s.cardSub}>
                {profile.species ? `${profile.species} · ` : ''}{profile.irrigation_method}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              <button style={s.btnSm} onClick={() => handleEdit(profile)}>
                Editar
              </button>
              <button
                style={{ ...s.btnSm, color: '#e74c3c', borderColor: '#3a1a1a' }}
                onClick={() => handleDelete(profile)}
              >
                Eliminar
              </button>
            </div>
          </div>
        ))}

        {/* Formulario crear / editar */}
        <form style={{ ...s.form, marginTop: '32px' }} onSubmit={handleSubmit}>
          <h3 style={{ ...s.title, fontSize: '14px' }}>
            {editingId ? 'Editar perfil' : 'Nuevo perfil'}
          </h3>

          <input
            style={s.input}
            placeholder="Nombre *"
            value={form.name}
            onChange={handleChange('name')}
            required
          />
          <input
            style={s.input}
            placeholder="Especie (opcional)"
            value={form.species}
            onChange={handleChange('species')}
          />

          {/* Rangos de sensores en grid 2 columnas */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <input style={s.input} placeholder="Temp mín (°C)" value={form.temp_min} onChange={handleChange('temp_min')} type="number" step="any" />
            <input style={s.input} placeholder="Temp máx (°C)" value={form.temp_max} onChange={handleChange('temp_max')} type="number" step="any" />
            <input style={s.input} placeholder="Humedad mín (%)" value={form.humidity_min} onChange={handleChange('humidity_min')} type="number" step="any" />
            <input style={s.input} placeholder="Humedad máx (%)" value={form.humidity_max} onChange={handleChange('humidity_max')} type="number" step="any" />
            <input style={s.input} placeholder="Luz mín (PAR)" value={form.light_min} onChange={handleChange('light_min')} type="number" step="any" />
            <input style={s.input} placeholder="Luz máx (PAR)" value={form.light_max} onChange={handleChange('light_max')} type="number" step="any" />
            <input style={s.input} placeholder="CO₂ mín (ppm)" value={form.co2_min} onChange={handleChange('co2_min')} type="number" step="any" />
            <input style={s.input} placeholder="CO₂ máx (ppm)" value={form.co2_max} onChange={handleChange('co2_max')} type="number" step="any" />
          </div>

          <input
            style={s.input}
            placeholder="Método de riego * (ej: pn_threshold)"
            value={form.irrigation_method}
            onChange={handleChange('irrigation_method')}
            required
          />

          <textarea
            style={{
              ...s.input,
              fontFamily: 'monospace',
              fontSize: '12px',
              minHeight: '100px',
              resize: 'vertical',
            }}
            placeholder={PLACEHOLDER_PARAMS}
            value={form.irrigation_params}
            onChange={handleChange('irrigation_params')}
            required
          />

          {formError && <p style={s.error}>{formError}</p>}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={s.btn} type="submit" disabled={loading}>
              {loading ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear perfil'}
            </button>
            {editingId && (
              <button
                type="button"
                style={{ ...s.btnSm, flex: '0 0 auto' }}
                onClick={resetForm}
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
