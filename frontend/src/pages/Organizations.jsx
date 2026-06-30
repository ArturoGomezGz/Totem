import { useNavigate } from 'react-router-dom'
import { Button, Card, Badge } from '../design-system'
import AppShell from '../components/AppShell'
import { useOrg } from '../contexts/OrgContext'

export default function Organizations() {
  const navigate      = useNavigate()
  const { orgs, switchOrg } = useOrg()

  const handleEnter = (org) => {
    switchOrg(org.id)
    navigate('/units')
  }

  return (
    <AppShell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-5)' }}>
        <h2 style={{
          fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)',
          fontSize: 'var(--text-xl)', color: 'var(--text-strong)',
        }}>
          Gestionar organizaciones
        </h2>
        <Button variant="primary" size="sm" onClick={() => navigate('/organizations/new')}>
          + Nueva
        </Button>
      </div>

      {orgs.length === 0 && (
        <div style={{
          textAlign: 'center', padding: 'var(--space-8) var(--space-4)',
          border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-md)',
          color: 'var(--text-muted)',
        }}>
          <p style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--text-base)' }}>
            Aún no tienes organizaciones.
          </p>
          <Button variant="primary" onClick={() => navigate('/organizations/new')}>
            Crear primera organización
          </Button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {orgs.map(org => (
          <Card key={org.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{
                fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
                fontSize: 'var(--text-base)', color: 'var(--text-strong)', marginBottom: 'var(--space-2)',
              }}>
                {org.name}
              </p>
              <Badge tone="neutral">{org.role}</Badge>
            </div>
            <Button variant="primary" size="sm" onClick={() => handleEnter(org)}>
              Seleccionar
            </Button>
          </Card>
        ))}
      </div>
    </AppShell>
  )
}
