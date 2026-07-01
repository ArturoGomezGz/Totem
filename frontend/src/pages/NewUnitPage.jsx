import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Button, Alert, Input, Select } from '../design-system'
import AppShell from '../components/AppShell'
import ProvisioningPanel from '../components/ProvisioningPanel'
import { useOrg } from '../contexts/OrgContext'

export default function NewUnitPage() {
  const navigate             = useNavigate()
  const { activeOrgId }      = useOrg()

  const [name, setName]       = useState('')
  const [type, setType]       = useState('totem')
  const [wifiSsid, setWifiSsid] = useState('')
  const [wifiPass, setWifiPass] = useState('')
  const [mqttUri, setMqttUri]   = useState('')
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
          <ProvisioningPanel
            unitId={created.id} apiKey={created.api_key}
            initialWifiSsid={wifiSsid} initialWifiPass={wifiPass}
            initialMqttUri={mqttUri || undefined}
          />
          <Button variant="primary" style={{ marginTop: 'var(--space-5)' }} onClick={() => navigate('/units')}>
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

          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
              Datos de red del dispositivo (opcional). Se usan solo para generar el archivo{' '}
              <code>nvs_config.csv</code> listo para flashear — no se envían al servidor.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <Input label="SSID WiFi" value={wifiSsid} onChange={e => setWifiSsid(e.target.value)} />
              <Input label="Contraseña WiFi" type="password" value={wifiPass} onChange={e => setWifiPass(e.target.value)} />
              <Input
                label="MQTT URI" value={mqttUri} onChange={e => setMqttUri(e.target.value)}
                hint="Ej: mqtt://192.168.1.50:1883 — IP local de tu server"
              />
            </div>
          </div>

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
