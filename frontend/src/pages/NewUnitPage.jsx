import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Button, Alert, Input, Select, Card } from '../design-system'
import AppShell from '../components/AppShell'
import { useOrg } from '../contexts/OrgContext'

export default function NewUnitPage() {
  const navigate             = useNavigate()
  const { activeOrgId }      = useOrg()

  const [name, setName]       = useState('')
  const [type, setType]       = useState('totem')
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [created, setCreated] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const unit = await api.createUnit({ organization_id: activeOrgId, type, name })
      setCreated(unit)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (created) {
    return (
      <AppShell>
        <div style={{ maxWidth: 480 }}>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)',
            fontSize: 'var(--text-xl)', color: 'var(--text-strong)', marginBottom: 'var(--space-2)',
          }}>
            Unidad registrada
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-5)' }}>
            La unidad <strong>{created.name}</strong> fue creada correctamente.
          </p>
          <Alert tone="warning" title="Guarda la API Key — solo se muestra una vez" style={{ marginBottom: 'var(--space-5)' }}>
            Copia esta clave y flashéala en el dispositivo antes de salir de esta página.
          </Alert>
          <Card style={{ marginBottom: 'var(--space-5)' }}>
            <span style={{
              fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
              fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
              display: 'block', marginBottom: 'var(--space-3)',
            }}>
              API Key
            </span>
            <code style={{
              display: 'block', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
              color: 'var(--blue-900)', wordBreak: 'break-all',
              background: 'var(--blue-050)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-4)',
            }}>
              {created.api_key}
            </code>
            <Button size="sm" variant="outline" style={{ marginTop: 'var(--space-3)' }}
              onClick={() => navigator.clipboard?.writeText(created.api_key)}>
              Copiar
            </Button>
          </Card>
          <Button variant="primary" onClick={() => navigate('/units')}>
            Ir a unidades
          </Button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
          <button
            onClick={() => navigate('/units')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-muted)', fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)' }}
          >
            ← Unidades
          </button>
          <span style={{ color: 'var(--border-default)' }}>/</span>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-xl)', color: 'var(--text-strong)', margin: 0 }}>
            Registrar unidad
          </h2>
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-6)' }}>
          Al registrar la unidad se generará una API Key que deberás cargar en el firmware del dispositivo.
        </p>

        {error && <Alert tone="danger" style={{ marginBottom: 'var(--space-4)' }} onClose={() => setError(null)}>{error}</Alert>}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Input label="Nombre *" value={name} onChange={e => setName(e.target.value)} autoFocus required />
          <Select label="Tipo de unidad" value={type} onChange={e => setType(e.target.value)}>
            <option value="totem">Totem</option>
            <option value="supply_tank">Tanque de suministro</option>
          </Select>
          <div style={{ display: 'flex', gap: 'var(--space-3)', paddingTop: 'var(--space-2)' }}>
            <Button type="submit" disabled={loading}>
              {loading ? 'Registrando...' : 'Registrar unidad'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate('/units')}>
              Cancelar
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}
