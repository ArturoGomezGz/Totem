import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { Button, Card, Alert, Badge } from '../design-system'
import AppShell from '../components/AppShell'
import { useOrg } from '../contexts/OrgContext'
import ProfileFormFields, { profileToForm, formToProfileBody } from '../components/ProfileFormFields'

const eyebrow = {
  fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
  fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
  display: 'block', marginBottom: 'var(--space-4)',
}

function InfoRow({ label, value, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-4)', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      {children ?? (
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)', textAlign: 'right' }}>
          {value}
        </span>
      )}
    </div>
  )
}

function formatRange(min, max, unit) {
  if (min == null && max == null) return 'Sin definir'
  if (min != null && max != null) return `${min} – ${max} ${unit}`
  if (min != null) return `≥ ${min} ${unit}`
  return `≤ ${max} ${unit}`
}

export default function ProfileDetail() {
  const { profileId }   = useParams()
  const navigate         = useNavigate()
  const { activeOrgId }  = useOrg()

  const [profile, setProfile]     = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [loading, setLoading]     = useState(true)

  const [editing, setEditing]           = useState(false)
  const [form, setForm]                 = useState(null)
  const [formError, setFormError]       = useState(null)
  const [saving, setSaving]             = useState(false)
  const [methods, setMethods]           = useState([])
  const [methodsError, setMethodsError] = useState(null)

  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting]           = useState(false)
  const [deleteError, setDeleteError]     = useState(null)

  const load = () => {
    if (!activeOrgId) return
    api.getProfiles(activeOrgId)
      .then(list => {
        const found = list.find(p => p.id === profileId)
        if (found) setProfile(found)
        else setLoadError('Perfil no encontrado.')
      })
      .catch(err => setLoadError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [activeOrgId, profileId]) // eslint-disable-line

  useEffect(() => {
    api.getIrrigationMethods()
      .then(setMethods)
      .catch(err => setMethodsError(err.message))
  }, [])

  const startEditing = () => {
    setForm(profileToForm(profile))
    setFormError(null)
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditing(false)
    setForm(null)
  }

  const handleFieldChange = (field, value) => setForm(f => ({ ...f, [field]: value }))

  const handleSave = async (e) => {
    e.preventDefault()
    setFormError(null)
    let body
    try {
      body = formToProfileBody(form, activeOrgId, methods)
    } catch (err) {
      setFormError(err.message)
      return
    }
    setSaving(true)
    try {
      const updated = await api.updateProfile(profileId, body)
      setProfile(updated)
      setEditing(false)
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true); setDeleteError(null)
    try {
      await api.deleteProfile(profileId)
      navigate('/profiles')
    } catch (err) {
      setDeleteError(err.message)
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <AppShell>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Cargando...</p>
      </AppShell>
    )
  }

  if (loadError || !profile) {
    return (
      <AppShell>
        <Alert tone="danger">{loadError ?? 'Perfil no encontrado.'}</Alert>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 600 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-xl)', color: 'var(--text-strong)', margin: 0 }}>
            {profile.name}
          </h2>
          {profile.species && <Badge tone="neutral">{profile.species}</Badge>}
          <span style={{ flex: 1 }} />
          {!editing && (
            <Button variant="outline" size="sm" onClick={startEditing}>
              Editar
            </Button>
          )}
        </div>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-6)' }}>
          <button
            onClick={() => navigate('/profiles')}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-muted)', textDecoration: 'underline', fontSize: 'inherit' }}
          >
            ← Volver a perfiles
          </button>
        </p>

        {editing ? (
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {formError && <Alert tone="danger" onClose={() => setFormError(null)}>{formError}</Alert>}
            <ProfileFormFields
              form={form}
              onChange={handleFieldChange}
              methods={methods}
              methodsError={methodsError}
            />
            <div style={{ display: 'flex', gap: 'var(--space-3)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--border-subtle)' }}>
              <Button type="submit" disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </Button>
              <Button type="button" variant="ghost" onClick={cancelEditing}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

            <Card>
              <span style={eyebrow}>Rangos óptimos de sensores</span>
              <InfoRow label="Temperatura" value={formatRange(profile.temp_min, profile.temp_max, '°C')} />
              <InfoRow label="Humedad" value={formatRange(profile.humidity_min, profile.humidity_max, '%')} />
              <InfoRow label="Luz" value={formatRange(profile.light_min, profile.light_max, 'PAR')} />
            </Card>

            <Card>
              <span style={eyebrow}>Parámetros de riego</span>
              <InfoRow label="Método" value={methods.find(m => m.key === profile.irrigation_method)?.name ?? profile.irrigation_method} />
              <div style={{ marginTop: 'var(--space-3)' }}>
                <pre style={{
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--text-strong)',
                  background: 'var(--surface-fill)', border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)', padding: '10px 14px', margin: 0,
                  overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {JSON.stringify(profile.irrigation_params, null, 2)}
                </pre>
              </div>
            </Card>

            <Card accent="var(--status-danger)">
              <span style={{ ...eyebrow, color: 'var(--status-danger)' }}>Zona de peligro</span>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
                Eliminar este perfil no afecta las unidades que ya tienen lecturas registradas, pero
                cualquier unidad con este perfil como activo se queda sin perfil asignado.
              </p>
              {!deleteConfirm ? (
                <Button variant="danger" size="sm" onClick={() => setDeleteConfirm(true)}>
                  Eliminar perfil
                </Button>
              ) : (
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)' }}>
                    ¿Seguro? No se puede revertir.
                  </span>
                  <Button variant="danger" size="sm" disabled={deleting} onClick={handleDelete}>
                    {deleting ? '...' : 'Sí, eliminar'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(false)}>
                    Cancelar
                  </Button>
                </div>
              )}
              {deleteError && <Alert tone="danger" style={{ marginTop: 'var(--space-3)' }}>{deleteError}</Alert>}
            </Card>

          </div>
        )}
      </div>
    </AppShell>
  )
}
