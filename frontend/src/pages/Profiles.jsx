import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { Button, Card, Alert } from '../design-system'
import AppShell from '../components/AppShell'
import { useOrg } from '../contexts/OrgContext'

export default function Profiles() {
  const { t }                      = useTranslation()
  const navigate                   = useNavigate()
  const { activeOrgId, activeOrg } = useOrg()

  const [profiles, setProfiles] = useState([])
  const [error, setError]       = useState(null)

  const load = async () => {
    if (!activeOrgId) return
    try {
      setProfiles(await api.getProfiles(activeOrgId))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { load() }, [activeOrgId]) // eslint-disable-line

  if (!activeOrgId) {
    return (
      <AppShell>
        <div style={{
          textAlign: 'center', padding: 'var(--space-9) var(--space-4)',
          border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-md)',
        }}>
          <p style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-base)', color: 'var(--text-strong)', marginBottom: 'var(--space-2)' }}>
            {t('common.noOrganizationActive')}
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            {t('profiles.selectOrgHint')}
          </p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-5)' }}>
        <div>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)',
            fontSize: 'var(--text-xl)', color: 'var(--text-strong)',
          }}>
            {t('profiles.title')}
          </h2>
          {activeOrg && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
              {activeOrg.name}
            </p>
          )}
        </div>
        <Button variant="primary" size="sm" onClick={() => navigate('/profiles/new')}>
          {t('profiles.newButton')}
        </Button>
      </div>

      {error && (
        <Alert tone="danger" style={{ marginBottom: 'var(--space-4)' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {profiles.length === 0 && !error && (
        <div style={{
          textAlign: 'center', padding: 'var(--space-8) var(--space-4)',
          border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-md)',
          color: 'var(--text-muted)',
        }}>
          <p style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--text-base)' }}>
            {t('profiles.noProfiles')}
          </p>
          <Button variant="primary" onClick={() => navigate('/profiles/new')}>
            {t('profiles.createFirst')}
          </Button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {profiles.map(profile => (
          <Card
            key={profile.id}
            interactive
            onClick={() => navigate(`/profiles/${profile.id}`)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
                fontSize: 'var(--text-base)', color: 'var(--text-strong)', marginBottom: 'var(--space-1)',
              }}>
                {profile.name}
              </p>
              <p style={{
                fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
                fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
              }}>
                {profile.species ? `${profile.species} · ` : ''}{profile.irrigation_method}
              </p>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 20, lineHeight: 1, flexShrink: 0 }}>›</span>
          </Card>
        ))}
      </div>
    </AppShell>
  )
}
