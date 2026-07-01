import { useState } from 'react'
import { api } from '../api'
import { Button, Card, Alert, Input, Badge, Select } from '../design-system'
import ProvisioningPanel from './ProvisioningPanel'

const TYPE_LABEL = { totem: 'Totem', supply_tank: 'Tanque de suministro' }

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
      setAssignMsg(res?.detail ?? 'Perfil asignado')
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

      <Card>
        <span style={eyebrow}>Información del dispositivo</span>

        <InfoRow label="Nombre">
          {editingName ? (
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
              <Input
                value={name} onChange={e => setName(e.target.value)} autoFocus
                style={{ maxWidth: 220 }}
                onKeyDown={e => { if (e.key === 'Enter' && !nameSaving && name.trim()) saveName() }}
              />
              <button
                aria-label="Guardar nombre" title="Guardar"
                style={{ ...iconBtn, color: 'var(--blue-700)', opacity: nameSaving || !name.trim() ? 0.5 : 1 }}
                disabled={nameSaving || !name.trim()}
                onClick={saveName}
              >
                ✓
              </button>
              <button aria-label="Cancelar" title="Cancelar" style={iconBtn} onClick={cancelEditName}>
                ×
              </button>
            </div>
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)' }}>{unit.name}</span>
              <button aria-label="Editar nombre" title="Editar nombre" style={iconBtn} onClick={() => setEditingName(true)}>
                ✎
              </button>
            </span>
          )}
        </InfoRow>

        <InfoRow label="ID" value={unit.id} mono />
        <InfoRow label="Tipo" value={TYPE_LABEL[unit.type] ?? unit.type} />
        <InfoRow label="Creada" value={new Date(unit.created_at).toLocaleString('es')} />
        <InfoRow label="Última conexión" value={unit.last_seen ? new Date(unit.last_seen).toLocaleString('es') : 'Nunca'} />
        <InfoRow label="Firmware" value={unit.firmware_version ?? 'Desconocida'} />

        {nameError && <Alert tone="danger" style={{ marginTop: 'var(--space-3)' }}>{nameError}</Alert>}
      </Card>

      {unit.type === 'totem' && (
        <Card>
          <span style={eyebrow}>Perfil de cultivo activo</span>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
            <Select
              style={{ flex: 1 }}
              value={selectedProfileId}
              onChange={e => { setSelectedProfileId(e.target.value); setAssignMsg(null); setAssignError(null) }}
            >
              <option value="">Sin perfil</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Button variant="primary" size="md" onClick={handleAssignProfile} disabled={assignLoading} style={{ flexShrink: 0 }}>
              {assignLoading ? '...' : 'Asignar'}
            </Button>
          </div>
          {assignMsg   && <Alert tone="success" style={{ marginTop: 'var(--space-3)' }}>{assignMsg}</Alert>}
          {assignError && <Alert tone="danger"  style={{ marginTop: 'var(--space-3)' }}>{assignError}</Alert>}
        </Card>
      )}

      <Card>
        <span style={eyebrow}>API Key</span>
        {regeneratedKey ? (
          <ProvisioningPanel unitId={unit.id} apiKey={regeneratedKey} />
        ) : (
          <>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
              Si perdiste la API Key o sospechas que se filtró, puedes regenerarla. La clave anterior
              deja de funcionar de inmediato — el dispositivo se desconectará hasta que lo reprovisiones
              con la nueva.
            </p>
            {!regenerateConfirm ? (
              <Button variant="outline" size="sm" onClick={() => setRegenerateConfirm(true)}>
                Regenerar API Key
              </Button>
            ) : (
              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)' }}>
                  ¿Confirmas? Esto invalida la clave actual.
                </span>
                <Button variant="primary" size="sm" disabled={regenerating} onClick={doRegenerate}>
                  {regenerating ? 'Regenerando...' : 'Sí, regenerar'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRegenerateConfirm(false)}>
                  Cancelar
                </Button>
              </div>
            )}
            {regenerateError && <Alert tone="danger" style={{ marginTop: 'var(--space-3)' }}>{regenerateError}</Alert>}
          </>
        )}
      </Card>

      <Card accent="var(--status-danger)">
        <span style={{ ...eyebrow, color: 'var(--status-danger)' }}>Zona de peligro</span>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
          Dar de baja revoca el acceso MQTT del dispositivo de inmediato. El historial de lecturas,
          eventos y alertas se conserva.
        </p>
        {!unit.is_active ? (
          <Badge tone="neutral">Unidad dada de baja</Badge>
        ) : !deactivateConfirm ? (
          <Button
            variant="outline" size="sm"
            style={{ borderColor: 'var(--status-danger)', color: 'var(--status-danger)' }}
            onClick={() => setDeactivateConfirm(true)}
          >
            Dar de baja
          </Button>
        ) : (
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)' }}>
              ¿Seguro? No se puede revertir desde el dashboard.
            </span>
            <Button
              variant="primary" size="sm" disabled={deactivating}
              style={{ background: 'var(--status-danger)' }}
              onClick={doDeactivate}
            >
              {deactivating ? '...' : 'Sí, dar de baja'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDeactivateConfirm(false)}>
              Cancelar
            </Button>
          </div>
        )}
        {deactivateError && <Alert tone="danger" style={{ marginTop: 'var(--space-3)' }}>{deactivateError}</Alert>}
      </Card>

    </div>
  )
}
