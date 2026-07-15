import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { Button, Alert, Input } from '../design-system'
import AppShell from '../components/AppShell'
import { useOrg } from '../contexts/OrgContext'

export default function NewOrganizationPage() {
  const { t }         = useTranslation()
  const navigate      = useNavigate()
  const { addOrg }    = useOrg()
  const [name, setName]       = useState('')
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const org = await api.createOrganization(name)
      addOrg(org)
      navigate('/units')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-xl)', color: 'var(--text-strong)', margin: 0 }}>
            {t('newOrganization.title')}
          </h2>
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-6)' }}>
          {t('newOrganization.description')}
        </p>

        {error && (
          <Alert tone="danger" style={{ marginBottom: 'var(--space-4)' }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Input
            label={t('newOrganization.nameLabel')}
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
            required
          />
          <div style={{ display: 'flex', gap: 'var(--space-3)', paddingTop: 'var(--space-2)' }}>
            <Button type="submit" disabled={loading}>
              {loading ? t('newOrganization.submitting') : t('newOrganization.submit')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate('/organizations')}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}
