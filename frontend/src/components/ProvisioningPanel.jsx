import { useState } from 'react'
import { Button, Alert, Card, Input } from '../design-system'
import { buildNvsCsv, downloadTextFile } from '../utils/nvsConfig'
import { copyToClipboard } from '../utils/clipboard'

const eyebrow = {
  fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
  fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
  display: 'block', marginBottom: 'var(--space-3)',
}

function stripMqttPrefix(uri) {
  return uri.startsWith('mqtt://') ? uri.slice(7) : uri
}

export default function ProvisioningPanel({
  unitId, apiKey, editable = true,
  initialWifiSsid = '', initialWifiPass = '', initialMqttUri = '<IP-de-tu-server>:1883',
}) {
  const [wifiSsid, setWifiSsid] = useState(initialWifiSsid)
  const [wifiPass, setWifiPass] = useState(initialWifiPass)
  const [mqttHost, setMqttHost] = useState(stripMqttPrefix(initialMqttUri))
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  const mqttUri = `mqtt://${mqttHost}`

  const getCsv = () => buildNvsCsv({ wifiSsid, wifiPass, mqttUri, unitId, apiKey })

  const download = () => downloadTextFile('nvs_config.csv', getCsv())

  const copyContent = () => {
    setCopyError(false)
    copyToClipboard(getCsv()).then(ok => {
      if (ok) {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } else {
        setCopyError(true)
      }
    })
  }

  return (
    <>
      <Alert tone="warning" title="Guarda esta información — no vuelve a mostrarse" style={{ marginBottom: 'var(--space-5)' }}>
        Descarga o copia el archivo de configuración antes de salir de esta página.
      </Alert>

      <Card>
        <span style={eyebrow}>Archivo de configuración (nvs_config.csv)</span>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
          Contiene la API Key y los datos de red para flashear el dispositivo. Se arma en tu
          navegador — no se envía ni se guarda en el servidor.
        </p>

        {editable && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
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
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-strong)' }}>
            API Key
          </span>
          <code style={{
            display: 'block', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
            color: 'var(--blue-900)', wordBreak: 'break-all',
            background: 'var(--blue-050)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-4)',
          }}>
            {apiKey}
          </code>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button variant="primary" size="md" onClick={download}>
            Descargar nvs_config.csv
          </Button>
          <Button variant="outline" size="md" onClick={copyContent}>
            {copied ? 'Copiado' : 'Copiar contenido'}
          </Button>
        </div>
        {copyError && (
          <Alert tone="danger" style={{ marginTop: 'var(--space-3)' }}>
            No se pudo copiar automáticamente — usa "Descargar" en su lugar.
          </Alert>
        )}
      </Card>
    </>
  )
}
