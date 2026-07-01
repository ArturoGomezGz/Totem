import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { Button, Alert, Input } from '../design-system'
import AppShell from '../components/AppShell'
import { useOrg } from '../contexts/OrgContext'

const PLACEHOLDER_PARAMS = `{
  "threshold_pn": 8.5,
  "cycle_duration_s": 30,
  "min_interval_s": 900
}`

const EMPTY_FORM = {
  name: '', species: '',
  temp_min: '', temp_max: '',
  humidity_min: '', humidity_max: '',
  light_min: '', light_max: '',
  co2_min: '', co2_max: '',
  irrigation_method: '', irrigation_params: '',
}

function toFloat(val) {
  const n = parseFloat(val)
  return isNaN(n) ? null : n
}

function profileToForm(p) {
  return {
    name: p.name ?? '', species: p.species ?? '',
    temp_min: p.temp_min     != null ? String(p.temp_min)     : '',
    temp_max: p.temp_max     != null ? String(p.temp_max)     : '',
    humidity_min: p.humidity_min != null ? String(p.humidity_min) : '',
    humidity_max: p.humidity_max != null ? String(p.humidity_max) : '',
    light_min: p.light_min   != null ? String(p.light_min)   : '',
    light_max: p.light_max   != null ? String(p.light_max)   : '',
    co2_min: p.co2_min       != null ? String(p.co2_min)     : '',
    co2_max: p.co2_max       != null ? String(p.co2_max)     : '',
    irrigation_method: p.irrigation_method ?? '',
    irrigation_params: JSON.stringify(p.irrigation_params, null, 2),
  }
}

const eyebrow = {
  fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
  fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
  marginBottom: 'var(--space-3)', display: 'block',
}

export default function ProfileFormPage() {
  const { profileId }     = useParams()
  const navigate          = useNavigate()
  const { activeOrgId }   = useOrg()
  const isEditing         = Boolean(profileId)

  const [form, setForm]               = useState(EMPTY_FORM)
  const [loadError, setLoadError]     = useState(null)
  const [formError, setFormError]     = useState(null)
  const [loading, setLoading]         = useState(false)
  const [loadingProfile, setLoadingProfile] = useState(isEditing)

  useEffect(() => {
    if (!isEditing || !activeOrgId) return
    api.getProfiles(activeOrgId)
      .then(list => {
        const found = list.find(p => p.id === profileId)
        if (found) setForm(profileToForm(found))
        else setLoadError('Perfil no encontrado.')
      })
      .catch(err => setLoadError(err.message))
      .finally(() => setLoadingProfile(false))
  }, [activeOrgId, profileId, isEditing])

  const handleChange = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

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
      organization_id: activeOrgId,
      name: form.name,
      species: form.species || null,
      temp_min: toFloat(form.temp_min),     temp_max: toFloat(form.temp_max),
      humidity_min: toFloat(form.humidity_min), humidity_max: toFloat(form.humidity_max),
      light_min: toFloat(form.light_min),   light_max: toFloat(form.light_max),
      co2_min: toFloat(form.co2_min),       co2_max: toFloat(form.co2_max),
      irrigation_method: form.irrigation_method,
      irrigation_params,
    }
    setLoading(true)
    try {
      if (isEditing) await api.updateProfile(profileId, body)
      else await api.createProfile(body)
      navigate('/profiles')
    } catch (err) {
      setFormError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const title = isEditing ? 'Editar perfil' : 'Nuevo perfil'

  if (loadingProfile) {
    return (
      <AppShell>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Cargando...</p>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 600 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-xl)', color: 'var(--text-strong)', margin: 0 }}>
            {title}
          </h2>
        </div>

        {loadError && <Alert tone="danger" style={{ marginBottom: 'var(--space-4)' }}>{loadError}</Alert>}
        {formError && <Alert tone="danger" style={{ marginBottom: 'var(--space-4)' }} onClose={() => setFormError(null)}>{formError}</Alert>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <span style={eyebrow}>Identificación</span>
            <Input label="Nombre *" value={form.name} onChange={handleChange('name')} autoFocus={!isEditing} required />
            <Input label="Especie" value={form.species} onChange={handleChange('species')} hint="Ej: Lactuca sativa, Ocimum basilicum" />
          </div>

          <div>
            <span style={eyebrow}>Rangos óptimos de sensores</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <Input label="Temp. mínima (°C)"    value={form.temp_min}     onChange={handleChange('temp_min')}     type="number" step="any" />
              <Input label="Temp. máxima (°C)"    value={form.temp_max}     onChange={handleChange('temp_max')}     type="number" step="any" />
              <Input label="Humedad mínima (%)"   value={form.humidity_min} onChange={handleChange('humidity_min')} type="number" step="any" />
              <Input label="Humedad máxima (%)"   value={form.humidity_max} onChange={handleChange('humidity_max')} type="number" step="any" />
              <Input label="Luz mínima (PAR)"     value={form.light_min}    onChange={handleChange('light_min')}    type="number" step="any" />
              <Input label="Luz máxima (PAR)"     value={form.light_max}    onChange={handleChange('light_max')}    type="number" step="any" />
              <Input label="CO₂ mínimo (ppm)"     value={form.co2_min}      onChange={handleChange('co2_min')}      type="number" step="any" />
              <Input label="CO₂ máximo (ppm)"     value={form.co2_max}      onChange={handleChange('co2_max')}      type="number" step="any" />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <span style={eyebrow}>Parámetros de riego</span>
            <Input
              label="Método de riego *"
              value={form.irrigation_method}
              onChange={handleChange('irrigation_method')}
              hint="Ej: pn_threshold"
              required
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <label style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-strong)' }}>
                Parámetros del método (JSON) *
              </label>
              <textarea
                value={form.irrigation_params}
                onChange={handleChange('irrigation_params')}
                placeholder={PLACEHOLDER_PARAMS}
                required
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--text-strong)',
                  background: 'var(--white)', border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)', padding: '10px 14px', minHeight: 120,
                  outline: 'none', width: '100%', boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-3)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--border-subtle)' }}>
            <Button type="submit" disabled={loading || !!loadError}>
              {loading ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Crear perfil'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate('/profiles')}>
              Cancelar
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}
