import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { Button, Card, Alert, Input, Badge } from '../design-system'

const eyebrow = {
  fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
  fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
  display: 'block', marginBottom: 'var(--space-4)',
}

const fmt = (iso) => new Date(iso).toLocaleString('es')

/**
 * Tarjeta de mantenimiento de una unidad.
 *
 * El mantenimiento es un estado de la Capa 2: no le ordena nada al dispositivo.
 * Lo único que detiene de verdad la unidad es desconectarla, y por eso la
 * instrucción de desconectarla aparece dos veces — antes de activar (para
 * decidir con esa información) y mientras está activa (para quien llegue
 * después). El badge no protege a nadie que meta la mano confiando en él.
 */
export default function MaintenancePanel({ unit, onUnitChange }) {
  const { t } = useTranslation()

  const [note, setNote]         = useState('')
  const [confirming, setConfirming] = useState(false)
  const [starting, setStarting] = useState(false)
  const [ending, setEnding]     = useState(false)
  const [error, setError]       = useState(null)
  const [history, setHistory]   = useState([])

  const active = unit.maintenance ?? null

  const loadHistory = () => {
    api.getMaintenance(unit.id).then(setHistory).catch(() => {})
  }

  useEffect(loadHistory, [unit.id])

  const doStart = async () => {
    setStarting(true); setError(null)
    try {
      const window = await api.startMaintenance(unit.id, note.trim())
      onUnitChange?.({ ...unit, maintenance: window })
      setNote('')
      setConfirming(false)
      loadHistory()
    } catch (err) {
      setError(err.message)
    } finally {
      setStarting(false)
    }
  }

  const doEnd = async () => {
    setEnding(true); setError(null)
    try {
      await api.endMaintenance(unit.id)
      onUnitChange?.({ ...unit, maintenance: null })
      loadHistory()
    } catch (err) {
      setError(err.message)
    } finally {
      setEnding(false)
    }
  }

  return (
    <Card accent={active ? 'var(--status-warning)' : null}>
      <span style={{ ...eyebrow, marginBottom: 'var(--space-3)' }}>
        {t('maintenance.title')}
      </span>

      {active ? (
        <>
          {/* La instrucción de desconectar va primero y con el peso visual más
              alto de la tarjeta: es el único mecanismo que realmente impide que
              la unidad riegue mientras alguien la interviene. */}
          <Alert tone="warning" title={t('maintenance.disconnectTitle')} style={{ marginBottom: 'var(--space-4)' }}>
            {t('maintenance.disconnectBody')}
          </Alert>

          <div style={{ marginBottom: 'var(--space-4)' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)', marginBottom: 'var(--space-1)' }}>
              {t('maintenance.activeSince', { date: fmt(active.started_at) })}
            </p>
            {active.started_by_email && (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                {t('maintenance.startedBy', { email: active.started_by_email })}
              </p>
            )}
            {active.note && (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-2)', fontStyle: 'italic' }}>
                “{active.note}”
              </p>
            )}
          </div>

          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
            {t('maintenance.endHint')}
          </p>
          <Button variant="primary" size="sm" disabled={ending} onClick={doEnd}>
            {ending ? t('maintenance.ending') : t('maintenance.endButton')}
          </Button>
        </>
      ) : confirming ? (
        <>
          {/* Confirmar no es fricción por burocracia: es el momento en que hay
              que enterarse de que activar esto NO apaga la unidad, antes de
              caminar hacia ella. */}
          <Alert tone="warning" title={t('maintenance.disconnectTitle')} style={{ marginBottom: 'var(--space-4)' }}>
            {t('maintenance.disconnectBody')}
          </Alert>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="primary" size="sm" disabled={starting} onClick={doStart}>
              {starting ? t('maintenance.starting') : t('maintenance.confirmStartButton')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              {t('organizationSettings.cancelEdit')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
            {t('maintenance.hint')}
          </p>
          <label style={{
            display: 'block', fontSize: 'var(--text-sm)', color: 'var(--text-strong)',
            marginBottom: 'var(--space-2)',
          }}>
            {t('maintenance.noteLabel')}
          </label>
          <Input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={t('maintenance.notePlaceholder')}
            style={{ marginBottom: 'var(--space-4)' }}
            onKeyDown={e => { if (e.key === 'Enter') setConfirming(true) }}
          />
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
            {t('maintenance.startButton')}
          </Button>
        </>
      )}

      {error && <Alert tone="danger" style={{ marginTop: 'var(--space-3)' }}>{error}</Alert>}

      {history.length > 0 && (
        <div style={{ marginTop: 'var(--space-5)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-subtle)' }}>
          <span style={{ ...eyebrow, marginBottom: 'var(--space-3)' }}>
            {t('maintenance.history')}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {history.map(w => (
              <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)' }}>
                <div>
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)' }}>
                    {fmt(w.started_at)}
                    {w.ended_at && <span style={{ color: 'var(--text-muted)' }}> → {fmt(w.ended_at)}</span>}
                  </p>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                    {t('maintenance.by', { email: w.started_by_email ?? '—' })}
                    {w.note && ` · ${w.note}`}
                  </p>
                </div>
                {!w.ended_at && (
                  <Badge tone="warning" style={{ flexShrink: 0 }}>
                    {t('maintenance.ongoing')}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
