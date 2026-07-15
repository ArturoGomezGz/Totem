import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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

const iconBtn = {
  background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
  color: 'var(--text-muted)', fontSize: 14, lineHeight: 1, flexShrink: 0,
}

function InfoRow({ label, value, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-4)', padding: '8px 0' }}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      {children ?? (
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)', textAlign: 'right' }}>{value}</span>
      )}
    </div>
  )
}

function RemoveMemberButton({ member, onRemoved }) {
  const { t } = useTranslation()
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
        {t('organizationSettings.remove')}
      </Button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <Button variant="ghost" size="sm" onClick={() => setConfirm(false)} disabled={removing}>{t('organizationSettings.cancelEdit')}</Button>
        <Button variant="danger" size="sm" onClick={doRemove} disabled={removing}>
          {removing ? t('organizationSettings.removing') : t('organizationSettings.confirmRemove')}
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  )
}

export default function OrganizationSettings() {
  const { t }               = useTranslation()
  const { organizationId } = useParams()
  const navigate            = useNavigate()
  const { orgs, updateOrgName } = useOrg()

  const org = orgs.find(o => o.id === organizationId)

  const [editingName, setEditingName] = useState(false)
  const [name, setName]               = useState(org?.name ?? '')
  const [nameSaving, setNameSaving]   = useState(false)
  const [nameError, setNameError]     = useState(null)

  const [members, setMembers] = useState([])
  const [error, setError]     = useState(null)
  const [notice, setNotice]   = useState(null)

  const [email, setEmail]         = useState('')
  const [role, setRole]           = useState('member')
  const [adding, setAdding]       = useState(false)
  const [addError, setAddError]   = useState(null)

  useEffect(() => { if (org && !editingName) setName(org.name) }, [org, editingName])

  const load = async () => {
    try {
      setMembers(await api.getMembers(organizationId))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { load() }, [organizationId]) // eslint-disable-line

  const saveName = async () => {
    setNameSaving(true); setNameError(null)
    try {
      const updated = await api.updateOrganization(organizationId, name)
      updateOrgName(organizationId, updated.name)
      setEditingName(false)
    } catch (err) {
      setNameError(err.message)
    } finally {
      setNameSaving(false)
    }
  }

  const cancelEditName = () => {
    setName(org?.name ?? '')
    setNameError(null)
    setEditingName(false)
  }

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setAdding(true); setAddError(null)
    try {
      await api.addMember(organizationId, email.trim(), role)
      setEmail(''); setRole('member')
      setNotice(t('organizationSettings.memberAdded'))
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
      setNotice(t('organizationSettings.roleUpdated', { email: member.email, role: newRole }))
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleRemove = async (member) => {
    await api.removeMember(organizationId, member.user_id)
    setNotice(t('organizationSettings.memberRemoved', { email: member.email }))
    await load()
  }

  if (org && org.role !== 'admin') {
    return (
      <AppShell>
        <Alert tone="danger">
          {t('organizationSettings.adminOnly')}
        </Alert>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 600 }}>
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)',
            fontSize: 'var(--text-xl)', color: 'var(--text-strong)', margin: 0,
          }}>
            {t('organizationSettings.title')}
          </h2>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
            <button
              onClick={() => navigate('/organizations')}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-muted)', textDecoration: 'underline', fontSize: 'inherit' }}
            >
              {t('organizationSettings.back')}
            </button>
          </p>
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

          <Card>
            <span style={eyebrow}>{t('organizationSettings.orgInfo')}</span>
            <InfoRow label={t('organizationSettings.name')}>
              {editingName ? (
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
                  <Input
                    value={name} onChange={e => setName(e.target.value)} autoFocus
                    style={{ maxWidth: 220 }}
                    onKeyDown={e => { if (e.key === 'Enter' && !nameSaving && name.trim()) saveName() }}
                  />
                  <button
                    aria-label={t('common.saveName')} title={t('common.save')}
                    style={{ ...iconBtn, color: 'var(--blue-700)', opacity: nameSaving || !name.trim() ? 0.5 : 1 }}
                    disabled={nameSaving || !name.trim()}
                    onClick={saveName}
                  >
                    ✓
                  </button>
                  <button aria-label={t('organizationSettings.cancelEdit')} title={t('organizationSettings.cancelEdit')} style={iconBtn} onClick={cancelEditName}>
                    ×
                  </button>
                </div>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)' }}>{org?.name}</span>
                  <button aria-label={t('common.editName')} title={t('common.editName')} style={iconBtn} onClick={() => setEditingName(true)}>
                    ✎
                  </button>
                </span>
              )}
            </InfoRow>
            {nameError && <Alert tone="danger" style={{ marginTop: 'var(--space-3)' }}>{nameError}</Alert>}
          </Card>

          <Card>
            <span style={eyebrow}>{t('organizationSettings.addMember')}</span>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
              {t('organizationSettings.addMemberHint')}
            </p>
            <form onSubmit={handleAdd} style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Input
                label={t('organizationSettings.email')} placeholder={t('organizationSettings.emailPlaceholder')} style={{ flex: '2 1 260px' }}
                value={email} onChange={e => setEmail(e.target.value)}
              />
              <Select label={t('organizationSettings.role')} value={role} onChange={e => setRole(e.target.value)} style={{ flex: '1 1 140px' }}>
                <option value="member">{t('organizationSettings.roleMember')}</option>
                <option value="admin">{t('organizationSettings.roleAdmin')}</option>
              </Select>
              <Button type="submit" variant="primary" size="md" disabled={adding || !email.trim()}>
                {adding ? t('organizationSettings.adding') : t('organizationSettings.add')}
              </Button>
            </form>
            {addError && <Alert tone="danger" style={{ marginTop: 'var(--space-3)' }}>{addError}</Alert>}
          </Card>

          <div>
            <span style={eyebrow}>{t('organizationSettings.members')}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {members.map(member => (
                <Card
                  key={member.user_id}
                  style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', rowGap: 'var(--space-3)' }}
                >
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)', marginBottom: 'var(--space-1)', wordBreak: 'break-word' }}>
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
                      <option value="member">{t('organizationSettings.roleMember')}</option>
                      <option value="admin">{t('organizationSettings.roleAdmin')}</option>
                    </Select>
                    <RemoveMemberButton member={member} onRemoved={handleRemove} />
                  </div>
                </Card>
              ))}
            </div>
          </div>

        </div>
      </div>
    </AppShell>
  )
}
