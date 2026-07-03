import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Button, Card, Alert, Badge } from '../design-system'
import AppShell from '../components/AppShell'
import { useOrg } from '../contexts/OrgContext'

export default function Profiles() {
  const navigate                   = useNavigate()
  const { activeOrgId, activeOrg } = useOrg()

  const [profiles, setProfiles] = useState([])
  const [error, setError]       = useState(null)
  const [deleting, setDeleting] = useState(null)

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

  const handleDelete = async (profile) => {
    setDeleting(profile.id)
    try {
      await api.deleteProfile(profile.id)
      setProfiles(ps => ps.filter(p => p.id !== profile.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(null)
    }
  }

  if (!activeOrgId) {
    return (
      <AppShell>
        <div style={{
          textAlign: 'center', padding: 'var(--space-9) var(--space-4)',
          border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-md)',
        }}>
          <p style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-base)', color: 'var(--text-strong)', marginBottom: 'var(--space-2)' }}>
            Sin organización activa
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            Selecciona una organización en el menú de la barra superior.
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
            Perfiles de cultivo
          </h2>
          {activeOrg && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
              {activeOrg.name}
            </p>
          )}
        </div>
        <Button variant="primary" size="sm" onClick={() => navigate('/profiles/new')}>
          + Nuevo
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
            No hay perfiles en esta organización.
          </p>
          <Button variant="primary" onClick={() => navigate('/profiles/new')}>
            Crear primer perfil
          </Button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {profiles.map(profile => (
          <Card key={profile.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
              <Button size="sm" variant="outline" onClick={() => navigate(`/profiles/${profile.id}/edit`)}>
                Editar
              </Button>
              <Button
                size="sm" variant="danger"
                disabled={deleting === profile.id}
                onClick={() => handleDelete(profile)}
              >
                {deleting === profile.id ? '...' : 'Eliminar'}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </AppShell>
  )
}
