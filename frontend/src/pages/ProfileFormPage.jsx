import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { Button, Alert } from '../design-system'
import AppShell from '../components/AppShell'
import { useOrg } from '../contexts/OrgContext'
import ProfileFormFields, { EMPTY_PROFILE_FORM, formToProfileBody } from '../components/ProfileFormFields'

export default function ProfileFormPage() {
  const { t }             = useTranslation()
  const navigate          = useNavigate()
  const { activeOrgId }   = useOrg()

  const [form, setForm]                 = useState(EMPTY_PROFILE_FORM)
  const [formError, setFormError]       = useState(null)
  const [methods, setMethods]           = useState([])
  const [methodsError, setMethodsError] = useState(null)
  const [loading, setLoading]           = useState(false)

  useEffect(() => {
    api.getIrrigationMethods()
      .then(setMethods)
      .catch(err => setMethodsError(err.message))
  }, [])

  const handleFieldChange = (field, value) => setForm(f => ({ ...f, [field]: value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError(null)
    let body
    try {
      body = formToProfileBody(form, activeOrgId, methods, t)
    } catch (err) {
      setFormError(err.message)
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
            {t('profileForm.newTitle')}
          </h2>
        </div>

        {formError && <Alert tone="danger" style={{ marginBottom: 'var(--space-4)' }} onClose={() => setFormError(null)}>{formError}</Alert>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <ProfileFormFields
            form={form}
            onChange={handleFieldChange}
            methods={methods}
            methodsError={methodsError}
            autoFocusName
          />

          <div style={{ display: 'flex', gap: 'var(--space-3)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--border-subtle)' }}>
            <Button type="submit" disabled={loading}>
              {loading ? t('profileForm.savingSubmit') : t('profileForm.createSubmit')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate('/profiles')}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}
