import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { Button, Card, Alert, Input, Badge, Select } from '../design-system'
import ProvisioningPanel from './ProvisioningPanel'
import MaintenancePanel from './MaintenancePanel'

const eyebrow = {
  fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
  fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
  display: 'block', marginBottom: 'var(--space-4)',
}

function InfoRow({ label, value, mono = false, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-4)', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      {children ?? (
        <span style={{
          fontSize: 'var(--text-sm)', color: 'var(--text-strong)', textAlign: 'right',
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-body)', wordBreak: 'break-all',
        }}>
          {value}
        </span>
      )}
    </div>
  )
}

const iconBtn = {
  background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
  color: 'var(--text-muted)', fontSize: 14, lineHeight: 1, flexShrink: 0,
}

export default function UnitSettingsPanel({ unit, profiles = [], onUnitChange }) {
  const { t } = useTranslation()
  const [editingName, setEditingName] = useState(false)
  const [name, setName]             = useState(unit.name)
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError]   = useState(null)

  const [selectedProfileId, setSelectedProfileId] = useState(unit.active_profile_id ?? '')
  const [assignMsg, setAssignMsg]         = useState(null)
  const [assignError, setAssignError]     = useState(null)
  const [assignLoading, setAssignLoading] = useState(false)

  const [regenerateConfirm, setRegenerateConfirm] = useState(false)
  const [regenerating, setRegenerating]           = useState(false)
  const [regenerateError, setRegenerateError]     = useState(null)
  const [regeneratedKey, setRegeneratedKey]       = useState(null)

  const [deactivateConfirm, setDeactivateConfirm] = useState(false)
  const [deactivating, setDeactivating]           = useState(false)
  const [deactivateError, setDeactivateError]     = useState(null)

  const saveName = async () => {
    setNameSaving(true); setNameError(null)
    try {
      const updated = await api.patchUnit(unit.id, { name })
      onUnitChange?.(updated)
      setEditingName(false)
    } catch (err) {
      setNameError(err.message)
    } finally {
      setNameSaving(false)
    }
  }

  const cancelEditName = () => {
    setName(unit.name)
    setNameError(null)
    setEditingName(false)
  }

  const handleAssignProfile = async () => {
    setAssignMsg(null); setAssignError(null); setAssignLoading(true)
    try {
      const res = await api.assignProfile(unit.id, selectedProfileId || null)
      onUnitChange?.({ ...unit, active_profile_id: selectedProfileId || null })
      setAssignMsg(res?.detail ?? t('unitSettings.profileAssigned'))
    } catch (err) {
      setAssignError(err.message)
    } finally {
      setAssignLoading(false)
    }
  }

  const doRegenerate = async () => {
    setRegenerating(true); setRegenerateError(null)
    try {
      const result = await api.regenerateUnitKey(unit.id)
      setRegeneratedKey(result.api_key)
      setRegenerateConfirm(false)
    } catch (err) {
      setRegenerateError(err.message)
    } finally {
      setRegenerating(false)
    }
  }

  const doDeactivate = async () => {
    setDeactivating(true); setDeactivateError(null)
    try {
      await api.deactivateUnit(unit.id)
      onUnitChange?.({ ...unit, is_active: false })
      setDeactivateConfirm(false)
    } catch (err) {
      setDeactivateError(err.message)
    } finally {
      setDeactivating(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', maxWidth: 560 }}>

      {/* Primero por frecuencia de uso, no por jerarquía conceptual: intervenir
          una unidad es rutina, y terminar un mantenimiento tiene urgencia real
          (la unidad puede estar regando mientras alguien la tiene abierta).
          Lo que va debajo —API key, dar de baja— casi nunca se toca. */}
      <MaintenancePanel unit={unit} onUnitChange={onUnitChange} />

      <Card>
        <span style={eyebrow}>{t('unitSettings.deviceInfo')}</span>

        <InfoRow label={t('unitSettings.name')}>
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
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)' }}>{unit.name}</span>
              <button aria-label={t('common.editName')} title={t('common.editName')} style={iconBtn} onClick={() => setEditingName(true)}>
                ✎
              </button>
            </span>
          )}
        </InfoRow>

        <InfoRow label={t('unitSettings.id')} value={unit.id} mono />
        <InfoRow label={t('unitSettings.type')} value={t(`unitType.${unit.type}`, { defaultValue: unit.type })} />
        <InfoRow label={t('unitSettings.created')} value={new Date(unit.created_at).toLocaleString('es')} />
        <InfoRow label={t('unitSettings.lastConnection')} value={unit.last_seen ? new Date(unit.last_seen).toLocaleString('es') : t('unitSettings.never')} />
        <InfoRow label={t('unitSettings.firmware')} value={unit.firmware_version ?? t('unitSettings.unknown')} />

        {nameError && <Alert tone="danger" style={{ marginTop: 'var(--space-3)' }}>{nameError}</Alert>}
      </Card>

      {unit.type === 'totem' && (
        <Card>
          <span style={eyebrow}>{t('unitSettings.activeProfile')}</span>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
            <Select
              style={{ flex: 1 }}
              value={selectedProfileId}
              onChange={e => { setSelectedProfileId(e.target.value); setAssignMsg(null); setAssignError(null) }}
            >
              <option value="">{t('unitSettings.noProfile')}</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Button variant="primary" size="md" onClick={handleAssignProfile} disabled={assignLoading} style={{ flexShrink: 0 }}>
              {assignLoading ? t('unitSettings.assigning') : t('unitSettings.assign')}
            </Button>
          </div>
          {assignMsg   && <Alert tone="success" style={{ marginTop: 'var(--space-3)' }}>{assignMsg}</Alert>}
          {assignError && <Alert tone="danger"  style={{ marginTop: 'var(--space-3)' }}>{assignError}</Alert>}
        </Card>
      )}

      <Card>
        <span style={eyebrow}>{t('unitSettings.apiKey')}</span>
        {regeneratedKey ? (
          <ProvisioningPanel unitId={unit.id} apiKey={regeneratedKey} />
        ) : (
          <>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
              {t('unitSettings.regenerateHint')}
            </p>
            {!regenerateConfirm ? (
              <Button variant="outline" size="sm" onClick={() => setRegenerateConfirm(true)}>
                {t('unitSettings.regenerateButton')}
              </Button>
            ) : (
              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)' }}>
                  {t('unitSettings.confirmRegenerate')}
                </span>
                <Button variant="primary" size="sm" disabled={regenerating} onClick={doRegenerate}>
                  {regenerating ? t('unitSettings.regenerating') : t('unitSettings.confirmRegenerateButton')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRegenerateConfirm(false)}>
                  {t('organizationSettings.cancelEdit')}
                </Button>
              </div>
            )}
            {regenerateError && <Alert tone="danger" style={{ marginTop: 'var(--space-3)' }}>{regenerateError}</Alert>}
          </>
        )}
      </Card>

      <Card accent="var(--status-danger)">
        <span style={{ ...eyebrow, color: 'var(--status-danger)' }}>{t('unitSettings.dangerZone')}</span>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
          {t('unitSettings.deactivateHint')}
        </p>
        {!unit.is_active ? (
          <Badge tone="neutral">{t('unitSettings.deactivated')}</Badge>
        ) : !deactivateConfirm ? (
          <Button
            variant="danger" size="sm"
            onClick={() => setDeactivateConfirm(true)}
          >
            {t('unitSettings.deactivateButton')}
          </Button>
        ) : (
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)' }}>
              {t('unitSettings.confirmDeactivate')}
            </span>
            <Button
              variant="danger" size="sm" disabled={deactivating}
              onClick={doDeactivate}
            >
              {deactivating ? t('unitSettings.deactivating') : t('unitSettings.confirmDeactivateButton')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDeactivateConfirm(false)}>
              {t('organizationSettings.cancelEdit')}
            </Button>
          </div>
        )}
        {deactivateError && <Alert tone="danger" style={{ marginTop: 'var(--space-3)' }}>{deactivateError}</Alert>}
      </Card>

    </div>
  )
}
