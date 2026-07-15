import { useState, useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
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

// "1.2.3" → { major, minor, patch }. null si no es semver de tres números.
function parseVersion(v) {
  if (!v) return null
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

// "1.2.3" → "1.2". null si no es semver de tres números.
function versionLine(v) {
  const parsed = parseVersion(v)
  return parsed ? `${parsed.major}.${parsed.minor}` : null
}

// Busca la actualización de patch disponible para una unidad: el release con el
// patch más alto dentro de la MISMA línea major.minor que la versión reportada.
// Los cambios de minor/major (p. ej. 1.2.x frente a 1.1.x) se ignoran a
// propósito — son versiones con funcionalidades distintas, posiblemente
// incompatibles, y no cuentan como "actualización pendiente". Devuelve null si
// la unidad ya está al día en su línea o si la versión reportada no es semver.
function findPatchUpdate(reportedVersion, releases) {
  const reported = parseVersion(reportedVersion)
  if (!reported) return null
  let best = null
  let bestPatch = reported.patch
  for (const r of releases) {
    const rv = parseVersion(r.version)
    if (!rv) continue
    if (rv.major !== reported.major || rv.minor !== reported.minor) continue
    if (rv.patch > bestPatch) { best = r; bestPatch = rv.patch }
  }
  return best
}

// Una fila del panel "Estado por unidad": versión reportada, badge de estado
// (Al día / Pendiente / Actualizando) y actualización directa a la última patch
// compatible de su línea major.minor.
function UnitVersionRow({ unit, releases, onDeployed }) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const [updating, setUpdating]     = useState(false)
  const [error, setError]           = useState(null)

  const target      = releases.find(r => r.id === unit.target_firmware_release_id)
  const reported    = parseVersion(unit.firmware_version)
  const patchUpdate = findPatchUpdate(unit.firmware_version, releases)
  // Si el objetivo pendiente ya es la actualización de patch disponible, la
  // unidad ya la está recibiendo — no volvemos a ofrecer el botón.
  const updateInFlight = patchUpdate && target && target.id === patchUpdate.id

  const doUpdate = async () => {
    setUpdating(true); setError(null)
    try {
      await api.deployFirmware(patchUpdate.id, { unit_id: unit.id })
      onDeployed(t('firmware.appliedNotice', { version: patchUpdate.version, unit: unit.name }))
    } catch (err) {
      setError(err.message)
      setUpdating(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)' }}>{unit.name}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            {t('firmware.reported', { version: unit.firmware_version ?? t('firmware.unknownVersion') })}
            {target && target.version !== unit.firmware_version && (
              <>{t('firmware.target', { version: target.version })}</>
            )}
          </span>
          {reported && (
            patchUpdate
              ? (updateInFlight
                  ? <Badge tone="neutral">{t('firmware.updating', { version: patchUpdate.version })}</Badge>
                  : <Badge tone="warning">{t('firmware.pending', { version: patchUpdate.version })}</Badge>)
              : <Badge tone="success">{t('firmware.upToDate')}</Badge>
          )}
          {patchUpdate && !updateInFlight && !confirming && (
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
              {t('firmware.updateButton')}
            </Button>
          )}
        </div>
      </div>
      {confirming && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', textAlign: 'right' }}>
            {t('firmware.confirmUpdateMessage', { version: patchUpdate.version, unit: unit.name })}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={updating}>
              {t('firmware.cancel')}
            </Button>
            <Button variant="primary" size="sm" onClick={doUpdate} disabled={updating}>
              {updating ? t('firmware.applying') : t('firmware.confirmUpdateButton', { version: patchUpdate.version })}
            </Button>
          </div>
          {error && <Alert tone="danger" style={{ width: '100%' }}>{error}</Alert>}
        </div>
      )}
    </div>
  )
}

function DeployRow({ release, units, open, onOpen, onClose, onDeployed }) {
  const { t } = useTranslation()
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
      onDeployed(res?.detail ?? t('firmware.appliedGeneric'))
    } catch (err) {
      setError(err.message)
      setDeploying(false)
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={onOpen}>
        {t('firmware.apply')}
      </Button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'flex-end', maxWidth: 360 }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', width: '100%' }}>
        <Select value={scope} onChange={e => setScope(e.target.value)} style={{ flex: 1 }}>
          <option value="org">{t('firmware.scopeOrg')}</option>
          <option value="unit">{t('firmware.scopeUnit')}</option>
        </Select>
        {!isOrgWide && (
          <Select value={unitId} onChange={e => setUnitId(e.target.value)} style={{ flex: 1 }}>
            {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        )}
      </div>

      {isOrgWide ? (
        <Alert tone="warning" style={{ width: '100%' }}>
          {t('firmware.scopeOrgWarning', { count: units.length })}
        </Alert>
      ) : (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', textAlign: 'right' }}>
          {t('firmware.scopeUnitWarning')}
        </p>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={deploying}>
          {t('firmware.cancel')}
        </Button>
        <Button
          variant={isOrgWide ? 'danger' : 'primary'} size="sm" onClick={doDeploy}
          disabled={deploying || (!isOrgWide && !unitId)}
        >
          {deploying ? t('firmware.applying') : isOrgWide ? t('firmware.confirmApplyOrg') : t('firmware.confirmApplyUnit')}
        </Button>
      </div>
      {error && <Alert tone="danger" style={{ width: '100%' }}>{error}</Alert>}
    </div>
  )
}

function DeleteReleaseButton({ release, pendingCount, open, onOpen, onClose, onDeleted }) {
  const { t } = useTranslation()
  const [deleting, setDeleting] = useState(false)
  const [error, setError]       = useState(null)

  const doDelete = async () => {
    setDeleting(true); setError(null)
    try {
      await api.deleteFirmware(release.id)
      onDeleted()
    } catch (err) {
      setError(err.message)
      setDeleting(false)
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" style={{ color: 'var(--status-danger)' }} onClick={onOpen}>
        {t('firmware.delete')}
      </Button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'flex-end', maxWidth: 320 }}>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)', textAlign: 'right' }}>
        {t('firmware.confirmDeleteMessage', { version: release.version })}
      </p>
      {pendingCount > 0 && (
        <Alert tone="warning" style={{ width: '100%' }}>
          {t('firmware.pendingCountWarning', { count: pendingCount })}
        </Alert>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={deleting}>
          {t('firmware.cancel')}
        </Button>
        <Button variant="danger" size="sm" onClick={doDelete} disabled={deleting}>
          {deleting ? t('firmware.deleting') : t('firmware.confirmDeleteButton')}
        </Button>
      </div>
      {error && <Alert tone="danger" style={{ width: '100%' }}>{error}</Alert>}
    </div>
  )
}

export default function Firmware() {
  const { t }                      = useTranslation()
  const { activeOrgId, activeOrg } = useOrg()

  const [releases, setReleases] = useState([])
  const [units, setUnits]       = useState([])
  const [methods, setMethods]   = useState([])
  const [error, setError]       = useState(null)
  const [notice, setNotice]     = useState(null)

  const [showUpload, setShowUpload] = useState(false)
  const [form, setForm]             = useState({ description: '', file: null, supported_irrigation_methods: [] })
  const [uploading, setUploading]   = useState(false)
  const [uploadError, setUploadError] = useState(null)

  useEffect(() => { api.getIrrigationMethods().then(setMethods).catch(() => {}) }, [])

  const toggleMethod = (key) => {
    setForm(f => ({
      ...f,
      supported_irrigation_methods: f.supported_irrigation_methods.includes(key)
        ? f.supported_irrigation_methods.filter(k => k !== key)
        : [...f.supported_irrigation_methods, key],
    }))
  }

  // Solo una acción (aplicar o eliminar) puede estar expandida a la vez,
  // por release — evita estados combinados confusos en la misma card.
  const [activeAction, setActiveAction] = useState(null) // { releaseId, type: 'deploy' | 'delete' }

  const [showVersionInfo, setShowVersionInfo] = useState(false)

  const [searchText, setSearchText] = useState('')
  const [lineFilter, setLineFilter] = useState('')

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
    if (!form.file) return
    setUploading(true); setUploadError(null)
    try {
      const release = await api.uploadFirmware({
        organization_id: activeOrgId,
        description: form.description.trim() || undefined,
        file: form.file,
        supported_irrigation_methods: form.supported_irrigation_methods,
      })
      setForm({ description: '', file: null, supported_irrigation_methods: [] })
      setShowUpload(false)
      setNotice(t('firmware.publishedNotice', { version: release.version }))
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
            {t('common.noOrganizationActive')}
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            {t('common.selectOrgInNavbar')}
          </p>
        </div>
      </AppShell>
    )
  }

  if (activeOrg && activeOrg.role !== 'admin') {
    return (
      <AppShell>
        <Alert tone="danger">
          {t('firmware.adminOnly')}
        </Alert>
      </AppShell>
    )
  }

  // Líneas major.minor únicas presentes en los releases, más reciente primero,
  // para poblar el selector "Todas las líneas" / "v1.3.x" / etc.
  const versionLines = [...new Set(releases.map(r => versionLine(r.version)).filter(Boolean))]
    .sort((a, b) => {
      const [aMaj, aMin] = a.split('.').map(Number)
      const [bMaj, bMin] = b.split('.').map(Number)
      return bMaj - aMaj || bMin - aMin
    })

  const filteredReleases = releases.filter(r => {
    const matchesText = !searchText.trim() || r.version.includes(searchText.trim())
    const matchesLine = !lineFilter || versionLine(r.version) === lineFilter
    return matchesText && matchesLine
  })

  return (
    <AppShell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-5)' }}>
        <div>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)',
            fontSize: 'var(--text-xl)', color: 'var(--text-strong)',
          }}>
            {t('firmware.title')}
          </h2>
          {activeOrg && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
              {activeOrg.name}
            </p>
          )}
        </div>
        {!showUpload && (
          <Button variant="primary" size="sm" onClick={() => setShowUpload(true)}>
            {t('firmware.publishButton')}
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
          <span style={eyebrow}>{t('firmware.publishNewVersion')}</span>
          <form onSubmit={handleUpload} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <Input
              label={t('firmware.descriptionLabel')} placeholder={t('firmware.descriptionPlaceholder')}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
            <Input
              label={t('firmware.binaryLabel')} type="file" accept=".bin"
              hint={t('firmware.binaryHint')}
              onChange={e => setForm(f => ({ ...f, file: e.target.files[0] ?? null }))}
            />
            <div>
              <label style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-strong)', display: 'block', marginBottom: 'var(--space-2)' }}>
                {t('firmware.supportedMethodsLabel')}
              </label>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
                {t('firmware.supportedMethodsHint')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {methods.map(m => (
                  <label key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--text-strong)' }}>
                    <input
                      type="checkbox"
                      checked={form.supported_irrigation_methods.includes(m.key)}
                      onChange={() => toggleMethod(m.key)}
                    />
                    {m.name}
                  </label>
                ))}
              </div>
            </div>
            {uploadError && <Alert tone="danger">{uploadError}</Alert>}
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button
                type="submit" variant="primary" size="sm"
                disabled={uploading || !form.file}
              >
                {uploading ? t('firmware.publishing') : t('firmware.publishSubmit')}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowUpload(false)} disabled={uploading}>
                {t('firmware.cancel')}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {units.length > 0 && (
        <Card style={{ marginBottom: 'var(--space-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
            <span style={{ ...eyebrow, marginBottom: 0 }}>{t('firmware.unitStatus')}</span>
            <button
              type="button"
              onClick={() => setShowVersionInfo(v => !v)}
              aria-label={t('firmware.unitStatusInfoAria')}
              aria-expanded={showVersionInfo}
              title={t('firmware.unitStatusInfoAria')}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 18, height: 18, borderRadius: '50%', cursor: 'pointer',
                border: '1px solid var(--border-default)', background: 'transparent',
                color: showVersionInfo ? 'var(--text-strong)' : 'var(--text-muted)',
                fontFamily: 'var(--font-display)', fontSize: 11, fontStyle: 'italic',
                fontWeight: 'var(--weight-bold)', lineHeight: 1, padding: 0,
              }}
            >
              i
            </button>
          </div>
          {showVersionInfo && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
              <Trans i18nKey="firmware.unitStatusInfoBody">
                Solo se marca como pendiente una actualización dentro de la misma línea de versión
                (mismo <code>major.minor</code>). Un cambio de línea — p. ej. de 1.1.x a 1.2.x — trae
                funcionalidades distintas y no se ofrece como actualización automática; aplícalo desde la
                lista de versiones de abajo.
              </Trans>
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {units.map(unit => (
              <UnitVersionRow
                key={unit.id}
                unit={unit}
                releases={releases}
                onDeployed={msg => { setNotice(msg); load() }}
              />
            ))}
          </div>
        </Card>
      )}

      {releases.length === 0 && !error ? (
        <div style={emptyState}>
          <p style={{ fontSize: 'var(--text-base)' }}>
            {t('firmware.noReleases')}
          </p>
        </div>
      ) : (
        <>
          <span style={eyebrow}>{t('firmware.publishedVersions')}</span>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Input
              aria-label={t('firmware.searchAria')}
              placeholder={t('firmware.searchPlaceholder')}
              icon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M11 11L14.5 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              }
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              style={{ flex: '1 1 220px' }}
            />
            <Select
              aria-label={t('firmware.lineFilterAria')}
              value={lineFilter}
              onChange={e => setLineFilter(e.target.value)}
              style={{ flex: '0 1 200px' }}
            >
              <option value="">{t('firmware.allLines')}</option>
              {versionLines.map(line => (
                <option key={line} value={line}>v{line}.x</option>
              ))}
            </Select>
          </div>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }} aria-live="polite">
            {t('firmware.resultCount', { filtered: filteredReleases.length, total: releases.length, count: releases.length })}
          </p>

          {filteredReleases.length === 0 ? (
            <div style={emptyState}>
              <p style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-3)' }}>
                {t('firmware.noMatches')}
              </p>
              <Button variant="ghost" size="sm" onClick={() => { setSearchText(''); setLineFilter('') }}>
                {t('firmware.clearFilters')}
              </Button>
            </div>
          ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {filteredReleases.map(release => {
            const pendingUnits = units.filter(u => u.target_firmware_release_id !== release.id)
            const allTargeted = units.length > 0 && pendingUnits.length === 0
            const targetingCount = units.length - pendingUnits.length
            const isDeployOpen = activeAction?.releaseId === release.id && activeAction.type === 'deploy'
            const isDeleteOpen = activeAction?.releaseId === release.id && activeAction.type === 'delete'
            const isActionOpen = isDeployOpen || isDeleteOpen
            return (
              <Card key={release.id} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-4)', rowGap: 'var(--space-4)' }}>
                <div style={{ flex: '1 1 220px', minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                    <p style={{
                      fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
                      fontSize: 'var(--text-base)', color: 'var(--text-strong)',
                    }}>
                      v{release.version}
                    </p>
                    {allTargeted && <Badge tone="success">{t('firmware.allTargeted')}</Badge>}
                  </div>
                  {release.description && (
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
                      {release.description}
                    </p>
                  )}
                  {release.supported_irrigation_methods?.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}>
                      {release.supported_irrigation_methods.map(key => (
                        <Badge key={key} tone="neutral">
                          {methods.find(m => m.key === key)?.name ?? key}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    SHA-256: {shortSha(release.sha256)}
                  </p>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
                    {t('firmware.publishedAt', { date: new Date(release.released_at).toLocaleString('es') })}
                  </p>
                </div>
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', alignItems: 'flex-end',
                  ...(isActionOpen ? { flexBasis: '100%' } : {}),
                }}>
                  {!isDeleteOpen && (
                    <DeployRow
                      release={release} units={units}
                      open={isDeployOpen}
                      onOpen={() => setActiveAction({ releaseId: release.id, type: 'deploy' })}
                      onClose={() => setActiveAction(null)}
                      onDeployed={msg => { setNotice(msg); setActiveAction(null); load() }}
                    />
                  )}
                  {!isDeployOpen && (
                    <DeleteReleaseButton
                      release={release} pendingCount={targetingCount}
                      open={isDeleteOpen}
                      onOpen={() => setActiveAction({ releaseId: release.id, type: 'delete' })}
                      onClose={() => setActiveAction(null)}
                      onDeleted={() => { setNotice(t('firmware.deletedNotice', { version: release.version })); setActiveAction(null); load() }}
                    />
                  )}
                </div>
              </Card>
            )
          })}
        </div>
          )}
        </>
      )}
    </AppShell>
  )
}
