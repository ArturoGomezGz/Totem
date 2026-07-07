import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Button, Card, Alert, Input, Select, Badge } from '../design-system'
import AppShell from '../components/AppShell'
import { useOrg } from '../contexts/OrgContext'

const eyebrow = {
  fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
  fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
  display: 'block', marginBottom: 'var(--space-4)',
}

function RemoveMemberButton({ member, onRemoved }) {
  const [confirm, setConfirm]     = useState(false)
  const [removing, setRemoving]   = useState(false)
  const [error, setError]         = useState(null)

  const doRemove = async () => {
    setRemoving(true); setError(null)
    try {
      await onRemoved(member)
    } catch (err) {
      setError(err.message)
      setRemoving(false)
    }
  }

  if (!confirm) {
    return (
      <Button variant="ghost" size="sm" style={{ color: 'var(--status-danger)' }} onClick={() => setConfirm(true)}>
        Quitar
      </Button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <Button variant="ghost" size="sm" onClick={() => setConfirm(false)} disabled={removing}>Cancelar</Button>
        <Button variant="danger" size="sm" onClick={doRemove} disabled={removing}>
          {removing ? 'Quitando...' : 'Sí, quitar'}
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  )
}

export default function OrganizationMembers() {
  const { organizationId } = useParams()
  const navigate           = useNavigate()
  const { orgs }           = useOrg()

  const org = orgs.find(o => o.id === organizationId)

  const [members, setMembers] = useState([])
  const [error, setError]     = useState(null)
  const [notice, setNotice]   = useState(null)

  const [email, setEmail]         = useState('')
  const [role, setRole]           = useState('member')
  const [adding, setAdding]       = useState(false)
  const [addError, setAddError]   = useState(null)

  const load = async () => {
    try {
      setMembers(await api.getMembers(organizationId))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { load() }, [organizationId]) // eslint-disable-line

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setAdding(true); setAddError(null)
    try {
      await api.addMember(organizationId, email.trim(), role)
      setEmail(''); setRole('member')
      setNotice('Miembro agregado.')
      await load()
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAdding(false)
    }
  }

  const handleRoleChange = async (member, newRole) => {
    try {
      await api.updateMemberRole(organizationId, member.user_id, newRole)
      setNotice(`Rol de ${member.email} actualizado a ${newRole}.`)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleRemove = async (member) => {
    await api.removeMember(organizationId, member.user_id)
    setNotice(`${member.email} ya no pertenece a esta organización.`)
    await load()
  }

  if (org && org.role !== 'admin') {
    return (
      <AppShell>
        <Alert tone="danger">
          Solo los administradores de la organización pueden gestionar miembros.
        </Alert>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <h2 style={{
          fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)',
          fontSize: 'var(--text-xl)', color: 'var(--text-strong)',
        }}>
          Miembros
        </h2>
        {org && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
            {org.name}
          </p>
        )}
      </div>

      {error && (
        <Alert tone="danger" style={{ marginBottom: 'var(--space-4)' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" style={{ marginBottom: 'var(--space-4)' }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Card style={{ marginBottom: 'var(--space-5)' }}>
        <span style={eyebrow}>Agregar miembro</span>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
          Solo puedes agregar usuarios que ya tengan una cuenta en Totem — pídele a la persona que se registre
          primero con el email que vas a usar aquí.
        </p>
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Input
            label="Email" placeholder="persona@ejemplo.com" style={{ flex: '2 1 260px' }}
            value={email} onChange={e => setEmail(e.target.value)}
          />
          <Select label="Rol" value={role} onChange={e => setRole(e.target.value)} style={{ flex: '1 1 140px' }}>
            <option value="member">Miembro</option>
            <option value="admin">Administrador</option>
          </Select>
          <Button type="submit" variant="primary" size="md" disabled={adding || !email.trim()}>
            {adding ? 'Agregando...' : 'Agregar'}
          </Button>
        </form>
        {addError && <Alert tone="danger" style={{ marginTop: 'var(--space-3)' }}>{addError}</Alert>}
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {members.map(member => (
          <Card key={member.user_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-4)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)', marginBottom: 'var(--space-1)' }}>
                {member.email}
              </p>
              <Badge tone={member.role === 'admin' ? 'blue' : 'neutral'}>{member.role}</Badge>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexShrink: 0 }}>
              <Select
                value={member.role}
                onChange={e => handleRoleChange(member, e.target.value)}
                style={{ minWidth: 140 }}
              >
                <option value="member">Miembro</option>
                <option value="admin">Administrador</option>
              </Select>
              <RemoveMemberButton member={member} onRemoved={handleRemove} />
            </div>
          </Card>
        ))}
      </div>

      <div style={{ marginTop: 'var(--space-5)' }}>
        <Button variant="ghost" size="sm" onClick={() => navigate('/organizations')}>
          ← Volver a organizaciones
        </Button>
      </div>
    </AppShell>
  )
}
