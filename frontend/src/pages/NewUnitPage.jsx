import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { api } from '../api'
import { Button, Alert, Input, Select } from '../design-system'
import AppShell from '../components/AppShell'
import ProvisioningPanel from '../components/ProvisioningPanel'
import { useOrg } from '../contexts/OrgContext'

export default function NewUnitPage() {
  const { t }                = useTranslation()
  const navigate             = useNavigate()
  const { activeOrgId }      = useOrg()

  const [name, setName]       = useState('')
  const [type, setType]       = useState('totem')
  const [wifiSsid, setWifiSsid] = useState('')
  const [wifiPass, setWifiPass] = useState('')
  const [mqttHost, setMqttHost] = useState('')
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
            {t('newUnit.createdTitle')}
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-5)' }}>
            <Trans i18nKey="newUnit.createdMessage" values={{ name: created.name }}>
              La unidad <strong>{{ name: created.name }}</strong> fue creada correctamente.
            </Trans>
          </p>
          <ProvisioningPanel
            unitId={created.id} apiKey={created.api_key} editable={false}
            initialWifiSsid={wifiSsid} initialWifiPass={wifiPass}
            initialMqttUri={mqttHost ? `mqtt://${mqttHost}` : undefined}
          />
          <Button variant="ghost" style={{ marginTop: 'var(--space-5)' }} onClick={() => navigate('/units')}>
            {t('common.backToUnits')}
          </Button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-xl)', color: 'var(--text-strong)', margin: 0 }}>
            {t('newUnit.title')}
          </h2>
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-6)' }}>
          {t('newUnit.description')}
        </p>

        {error && <Alert tone="danger" style={{ marginBottom: 'var(--space-4)' }} onClose={() => setError(null)}>{error}</Alert>}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Input label={t('newUnit.nameLabel')} value={name} onChange={e => setName(e.target.value)} autoFocus required />
          <Select label={t('newUnit.typeLabel')} value={type} onChange={e => setType(e.target.value)}>
            <option value="totem">{t('unitType.totem')}</option>
            <option value="supply_tank">{t('unitType.supply_tank')}</option>
          </Select>

          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
              <Trans i18nKey="newUnit.networkHint">
                Datos de red del dispositivo (opcional). Se usan solo para generar el archivo{' '}
                <code>nvs_config.csv</code> listo para flashear — no se envían al servidor.
              </Trans>
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <Input label={t('newUnit.wifiSsid')} value={wifiSsid} onChange={e => setWifiSsid(e.target.value)} />
              <Input label={t('newUnit.wifiPassword')} type="password" value={wifiPass} onChange={e => setWifiPass(e.target.value)} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <label style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-strong)' }}>
                  {t('newUnit.mqttUri')}
                </label>
                <div style={{ display: 'flex', alignItems: 'stretch', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                  <span style={{
                    display: 'flex', alignItems: 'center', padding: '10px 12px',
                    background: 'var(--bg-subtle)', borderRight: '1px solid var(--border-default)',
                    fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
                    whiteSpace: 'nowrap', userSelect: 'none',
                  }}>
                    mqtt://
                  </span>
                  <input
                    value={mqttHost}
                    onChange={e => setMqttHost(e.target.value)}
                    placeholder="192.168.1.100:1883"
                    style={{
                      flex: 1, border: 'none', outline: 'none', padding: '10px 14px',
                      fontFamily: 'var(--font-body)', fontSize: 'var(--text-base)', color: 'var(--text-strong)',
                      background: 'var(--white)',
                    }}
                  />
                </div>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                  {t('newUnit.mqttHint')}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-3)', paddingTop: 'var(--space-2)' }}>
            <Button type="submit" disabled={loading}>
              {loading ? t('newUnit.submitting') : t('newUnit.submit')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate('/units')}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}
