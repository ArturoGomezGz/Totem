import { useState } from 'react'
import { Button, Alert, Card, Input } from '../design-system'
import { buildNvsCsv, downloadTextFile } from '../utils/nvsConfig'

const eyebrow = {
  fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
  fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
  display: 'block', marginBottom: 'var(--space-3)',
}

export default function ProvisioningPanel({
  unitId, apiKey,
  initialWifiSsid = '', initialWifiPass = '', initialMqttUri = 'mqtt://<IP-de-tu-server>:1883',
}) {
  const [wifiSsid, setWifiSsid] = useState(initialWifiSsid)
  const [wifiPass, setWifiPass] = useState(initialWifiPass)
  const [mqttUri, setMqttUri]   = useState(initialMqttUri)

  const download = () => {
    const csv = buildNvsCsv({ wifiSsid, wifiPass, mqttUri, unitId, apiKey })
    downloadTextFile('nvs_config.csv', csv)
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Input label="SSID WiFi" value={wifiSsid} onChange={e => setWifiSsid(e.target.value)} />
          <Input label="Contraseña WiFi" type="password" value={wifiPass} onChange={e => setWifiPass(e.target.value)} />
          <Input
            label="MQTT URI" value={mqttUri} onChange={e => setMqttUri(e.target.value)}
            hint="IP local de tu server (RPi/PC), puerto 1883"
          />
        </div>
        <Button variant="primary" size="sm" style={{ marginTop: 'var(--space-4)' }} onClick={download}>
          Descargar nvs_config.csv
        </Button>
      </Card>
    </>
  )
}
