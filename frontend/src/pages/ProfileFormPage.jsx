import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Button, Alert } from '../design-system'
import AppShell from '../components/AppShell'
import { useOrg } from '../contexts/OrgContext'
import ProfileFormFields, { EMPTY_PROFILE_FORM, formToProfileBody } from '../components/ProfileFormFields'

export default function ProfileFormPage() {
  const navigate          = useNavigate()
  const { activeOrgId }   = useOrg()

  const [form, setForm]               = useState(EMPTY_PROFILE_FORM)
  const [formError, setFormError]     = useState(null)
  const [paramsError, setParamsError] = useState(null)
  const [paramsFocus, setParamsFocus] = useState(false)
  const [loading, setLoading]         = useState(false)

  const handleFieldChange = (field, value) => setForm(f => ({ ...f, [field]: value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError(null)
    setParamsError(null)
    let body
    try {
      body = formToProfileBody(form, activeOrgId)
    } catch {
      setParamsError('No es JSON válido — revisa comas, comillas o llaves faltantes.')
      return
    }
    setLoading(true)
    try {
      await api.createProfile(body)
      navigate('/profiles')
    } catch (err) {
      setFormError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 600 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-xl)', color: 'var(--text-strong)', margin: 0 }}>
            Nuevo perfil
          </h2>
        </div>

        {formError && <Alert tone="danger" style={{ marginBottom: 'var(--space-4)' }} onClose={() => setFormError(null)}>{formError}</Alert>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <ProfileFormFields
            form={form}
            onChange={handleFieldChange}
            paramsError={paramsError}
            paramsFocus={paramsFocus}
            onParamsFocus={() => setParamsFocus(true)}
            onParamsBlur={() => setParamsFocus(false)}
            autoFocusName
          />

          <div style={{ display: 'flex', gap: 'var(--space-3)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--border-subtle)' }}>
            <Button type="submit" disabled={loading}>
              {loading ? 'Guardando...' : 'Crear perfil'}
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
