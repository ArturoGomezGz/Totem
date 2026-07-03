import { useState, useEffect } from 'react'
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

const emptyState = {
  textAlign: 'center', padding: 'var(--space-8) var(--space-4)',
  border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-md)',
  color: 'var(--text-muted)',
}

function shortSha(sha) {
  return `${sha.slice(0, 8)}…${sha.slice(-6)}`
}

function DeployRow({ release, units, onDeployed }) {
  const [open, setOpen]           = useState(false)
  const [scope, setScope]         = useState('org')
  const [unitId, setUnitId]       = useState(units[0]?.id ?? '')
  const [deploying, setDeploying] = useState(false)
  const [error, setError]         = useState(null)

  const isOrgWide = scope === 'org'

  const doDeploy = async () => {
    setDeploying(true); setError(null)
    try {
      const target = isOrgWide
        ? { organization_id: release.organization_id }
        : { unit_id: unitId }
      const res = await api.deployFirmware(release.id, target)
      onDeployed(res?.detail ?? 'Firmware aplicado')
      setOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setDeploying(false)
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Aplicar
      </Button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'flex-end', maxWidth: 360 }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', width: '100%' }}>
        <Select value={scope} onChange={e => setScope(e.target.value)} style={{ flex: 1 }}>
          <option value="org">Toda la organización</option>
          <option value="unit">Una unidad</option>
        </Select>
        {!isOrgWide && (
          <Select value={unitId} onChange={e => setUnitId(e.target.value)} style={{ flex: 1 }}>
            {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        )}
      </div>

      {isOrgWide ? (
        <Alert tone="warning" style={{ width: '100%' }}>
          Se aplicará de inmediato a todas las unidades Totem activas de la organización — {units.length} unidad{units.length === 1 ? '' : 'es'}. Esto afecta hardware en operación.
        </Alert>
      ) : (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', textAlign: 'right' }}>
          Se aplicará solo a la unidad seleccionada.
        </p>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={deploying}>
          Cancelar
        </Button>
        <Button
          variant={isOrgWide ? 'danger' : 'primary'} size="sm" onClick={doDeploy}
          disabled={deploying || (!isOrgWide && !unitId)}
        >
          {deploying ? 'Aplicando...' : isOrgWide ? 'Sí, aplicar a toda la organización' : 'Confirmar'}
        </Button>
      </div>
      {error && <Alert tone="danger" style={{ width: '100%' }}>{error}</Alert>}
    </div>
  )
}

export default function Firmware() {
  const { activeOrgId, activeOrg } = useOrg()

  const [releases, setReleases] = useState([])
  const [units, setUnits]       = useState([])
  const [error, setError]       = useState(null)
  const [notice, setNotice]     = useState(null)

  const [showUpload, setShowUpload] = useState(false)
  const [form, setForm]             = useState({ version: '', description: '', file: null })
  const [uploading, setUploading]   = useState(false)
  const [uploadError, setUploadError] = useState(null)

  const load = async () => {
    if (!activeOrgId) return
    try {
      const [r, u] = await Promise.all([
        api.getFirmwareReleases(activeOrgId),
        api.getUnits(activeOrgId),
      ])
      setReleases(r)
      setUnits(u.filter(unit => unit.type === 'totem' && unit.is_active))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { load() }, [activeOrgId]) // eslint-disable-line

  const handleUpload = async (e) => {
    e.preventDefault()
    if (!form.version.trim() || !form.file) return
    setUploading(true); setUploadError(null)
    try {
      await api.uploadFirmware({
        organization_id: activeOrgId,
        version: form.version.trim(),
        description: form.description.trim() || undefined,
        file: form.file,
      })
      setForm({ version: '', description: '', file: null })
      setShowUpload(false)
      setNotice('Versión publicada correctamente.')
      await load()
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
    }
  }

  if (!activeOrgId) {
    return (
      <AppShell>
        <div style={{ ...emptyState, padding: 'var(--space-9) var(--space-4)' }}>
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

  if (activeOrg && activeOrg.role !== 'admin') {
    return (
      <AppShell>
        <Alert tone="danger">
          Solo los administradores de la organización pueden gestionar versiones de firmware.
        </Alert>
      </AppShell>
    )
  }

  const latestRelease = releases[0] ?? null

  return (
    <AppShell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-5)' }}>
        <div>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)',
            fontSize: 'var(--text-xl)', color: 'var(--text-strong)',
          }}>
            Firmware
          </h2>
          {activeOrg && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
              {activeOrg.name}
            </p>
          )}
        </div>
        {!showUpload && (
          <Button variant="primary" size="sm" onClick={() => setShowUpload(true)}>
            + Publicar versión
          </Button>
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

      {showUpload && (
        <Card style={{ marginBottom: 'var(--space-5)' }}>
          <span style={eyebrow}>Publicar nueva versión</span>
          <form onSubmit={handleUpload} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <Input
                label="Versión" placeholder="1.2.0" style={{ flex: '1 1 160px' }}
                value={form.version}
                onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
              />
              <Input
                label="Descripción (opcional)" placeholder="Qué cambia en esta versión" style={{ flex: '2 1 260px' }}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
            <Input
              label="Binario (.bin)" type="file" accept=".bin"
              onChange={e => setForm(f => ({ ...f, file: e.target.files[0] ?? null }))}
            />
            {uploadError && <Alert tone="danger">{uploadError}</Alert>}
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button
                type="submit" variant="primary" size="sm"
                disabled={uploading || !form.version.trim() || !form.file}
              >
                {uploading ? 'Publicando...' : 'Publicar versión'}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowUpload(false)} disabled={uploading}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}

      {units.length > 0 && (
        <Card style={{ marginBottom: 'var(--space-5)' }}>
          <span style={eyebrow}>Estado por unidad</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {units.map(unit => {
              const target = releases.find(r => r.id === unit.target_firmware_release_id)
              const upToDate = latestRelease && unit.firmware_version === latestRelease.version
              return (
                <div key={unit.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)' }}>{unit.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                      Reportada: {unit.firmware_version ?? 'Desconocida'}
                      {target && target.version !== unit.firmware_version && (
                        <> · Objetivo: v{target.version}</>
                      )}
                    </span>
                    {latestRelease && (
                      upToDate
                        ? <Badge tone="success">Al día</Badge>
                        : <Badge tone="warning">Pendiente v{latestRelease.version}</Badge>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {releases.length === 0 && !error ? (
        <div style={emptyState}>
          <p style={{ fontSize: 'var(--text-base)' }}>
            No hay versiones de firmware publicadas en esta organización.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {releases.map(release => {
            const pendingUnits = units.filter(u => u.target_firmware_release_id !== release.id)
            const allTargeted = units.length > 0 && pendingUnits.length === 0
            return (
              <Card key={release.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-4)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                    <p style={{
                      fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
                      fontSize: 'var(--text-base)', color: 'var(--text-strong)',
                    }}>
                      v{release.version}
                    </p>
                    {allTargeted && <Badge tone="success">Todas apuntan aquí</Badge>}
                  </div>
                  {release.description && (
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
                      {release.description}
                    </p>
                  )}
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    SHA-256: {shortSha(release.sha256)}
                  </p>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
                    Publicado {new Date(release.released_at).toLocaleString('es')}
                  </p>
                </div>
                <DeployRow release={release} units={units} onDeployed={msg => { setNotice(msg); load() }} />
              </Card>
            )
          })}
        </div>
      )}
    </AppShell>
  )
}
