import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Button, Alert, Input } from '../design-system'
import AppShell from '../components/AppShell'

export default function NewOrganizationPage() {
  const navigate      = useNavigate()
  const [name, setName]       = useState('')
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      await api.createOrganization(name)
      navigate('/organizations')
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
          <button
            onClick={() => navigate('/organizations')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-muted)', fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)' }}
          >
            ← Organizaciones
          </button>
          <span style={{ color: 'var(--border-default)' }}>/</span>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-xl)', color: 'var(--text-strong)', margin: 0 }}>
            Nueva organización
          </h2>
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-6)' }}>
          Una organización agrupa las unidades Totem y los perfiles de cultivo de un mismo proyecto o instalación.
        </p>

        {error && (
          <Alert tone="danger" style={{ marginBottom: 'var(--space-4)' }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Input
            label="Nombre de la organización *"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
            required
          />
          <div style={{ display: 'flex', gap: 'var(--space-3)', paddingTop: 'var(--space-2)' }}>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creando...' : 'Crear organización'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate('/organizations')}>
              Cancelar
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}
