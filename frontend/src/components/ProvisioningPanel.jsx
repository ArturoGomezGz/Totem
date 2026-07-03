import { useState } from 'react'
import { Button, Alert, Card, Input } from '../design-system'
import { buildNvsCsv, downloadTextFile } from '../utils/nvsConfig'

const eyebrow = {
  fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
  fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
  display: 'block', marginBottom: 'var(--space-3)',
}

function stripMqttPrefix(uri) {
  return uri.startsWith('mqtt://') ? uri.slice(7) : uri
}

function ReadOnlyField({ label, value, mono = false }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-strong)' }}>
        {label}
      </span>
      <span style={{
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-body)', fontSize: 'var(--text-base)', color: 'var(--text-strong)',
        padding: '10px 14px', background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
      }}>
        {value}
      </span>
    </div>
  )
}

export default function ProvisioningPanel({
  unitId, apiKey, editable = true,
  initialWifiSsid = '', initialWifiPass = '', initialMqttUri = '<IP-de-tu-server>:1883',
}) {
  const [wifiSsid, setWifiSsid] = useState(initialWifiSsid)
  const [wifiPass, setWifiPass] = useState(initialWifiPass)
  const [mqttHost, setMqttHost] = useState(stripMqttPrefix(initialMqttUri))
  const [copied, setCopied] = useState(false)

  const mqttUri = `mqtt://${mqttHost}`

  const getCsv = () => buildNvsCsv({ wifiSsid, wifiPass, mqttUri, unitId, apiKey })

  const download = () => downloadTextFile('nvs_config.csv', getCsv())

  const copyContent = () => {
    navigator.clipboard?.writeText(getCsv()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <>
      <Alert tone="warning" title="Guarda la API Key — solo se muestra una vez" style={{ marginBottom: 'var(--space-5)' }}>
        Copia esta clave o descarga el archivo de configuración antes de salir de esta página.
      </Alert>

      <Card style={{ marginBottom: 'var(--space-5)' }}>
        <span style={eyebrow}>API Key</span>
        <code style={{
          display: 'block', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
          color: 'var(--blue-900)', wordBreak: 'break-all',
          background: 'var(--blue-050)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-4)',
        }}>
          {apiKey}
        </code>
        <Button size="sm" variant="outline" style={{ marginTop: 'var(--space-3)' }}
          onClick={() => navigator.clipboard?.writeText(apiKey)}>
          Copiar
        </Button>
      </Card>

      <Card>
        <span style={eyebrow}>Datos de red</span>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
          Solo se usan para armar el archivo <code>nvs_config.csv</code> en tu navegador —
          no se envían ni se guardan en el servidor.
        </p>

        {editable ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <Input label="SSID WiFi" value={wifiSsid} onChange={e => setWifiSsid(e.target.value)} />
            <Input label="Contraseña WiFi" type="password" value={wifiPass} onChange={e => setWifiPass(e.target.value)} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <label style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-strong)' }}>
                MQTT URI
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
                IP local de tu server (RPi/PC), puerto 1883
              </span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <ReadOnlyField label="SSID WiFi" value={wifiSsid || '—'} />
            <ReadOnlyField label="Contraseña WiFi" value={wifiPass ? '••••••••' : '—'} />
            <ReadOnlyField label="MQTT URI" value={mqttUri} mono />
          </div>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
          <Button variant="primary" size="sm" onClick={download}>
            Descargar nvs_config.csv
          </Button>
          <Button variant="outline" size="sm" onClick={copyContent}>
            {copied ? 'Copiado' : 'Copiar contenido'}
          </Button>
        </div>
      </Card>
    </>
  )
}
