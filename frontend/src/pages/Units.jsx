import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Button, Card, Badge, Alert } from '../design-system'
import AppShell from '../components/AppShell'
import { useOrg } from '../contexts/OrgContext'

const TYPE_LABEL = { totem: 'Totem', supply_tank: 'Tanque de suministro' }

export default function Units() {
  const navigate                   = useNavigate()
  const { activeOrgId, activeOrg } = useOrg()

  const [units, setUnits]       = useState([])
  const [profiles, setProfiles] = useState([])
  const [error, setError]       = useState(null)

  useEffect(() => {
    if (!activeOrgId) return
    api.getUnits(activeOrgId)
      .then(data => { setUnits(data); setError(null) })
      .catch(err => setError(err.message))
    api.getProfiles(activeOrgId).then(setProfiles).catch(() => {})
  }, [activeOrgId])

  const profileName = (id) => profiles.find(p => p.id === id)?.name

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
            Selecciona una organización en el menú de la barra superior para ver las unidades.
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
            Unidades
          </h2>
          {activeOrg && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
              {activeOrg.name}
            </p>
          )}
        </div>
        <Button variant="primary" size="sm" onClick={() => navigate('/units/new')}>
          + Registrar
        </Button>
      </div>

      {error && (
        <Alert tone="danger" style={{ marginBottom: 'var(--space-4)' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {units.length === 0 && !error && (
        <div style={{
          textAlign: 'center', padding: 'var(--space-8) var(--space-4)',
          border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-md)',
          color: 'var(--text-muted)',
        }}>
          <p style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--text-base)' }}>
            No hay unidades registradas en esta organización.
          </p>
          <Button variant="primary" onClick={() => navigate('/units/new')}>
            Registrar primera unidad
          </Button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {units.map(unit => (
          <Card
            key={unit.id}
            interactive
            onClick={() => navigate(`/units/${unit.id}`)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          >
            <div>
              <p style={{
                fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
                fontSize: 'var(--text-base)', color: 'var(--text-strong)', marginBottom: 'var(--space-2)',
              }}>
                {unit.name}
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge tone="neutral">{TYPE_LABEL[unit.type] ?? unit.type}</Badge>
                {unit.type === 'totem' && (
                  <Badge tone={unit.active_profile_id ? 'blue' : 'warning'}>
                    {unit.active_profile_id ? (profileName(unit.active_profile_id) ?? '...') : 'Sin perfil'}
                  </Badge>
                )}
              </div>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 20, lineHeight: 1 }}>›</span>
          </Card>
        ))}
      </div>
    </AppShell>
  )
}
