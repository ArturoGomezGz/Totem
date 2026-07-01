// Genera el nvs_config.csv descrito en firmware/simulator/PROVISIONING.md.
// wifi_ssid / wifi_pass / mqtt_uri son datos de red del usuario — se usan
// solo aquí, en el navegador, y nunca se envían al servidor.

export function buildNvsCsv({ wifiSsid, wifiPass, mqttUri, unitId, apiKey }) {
  return [
    'key,type,encoding,value',
    'config,namespace,,',
    `wifi_ssid,data,string,${wifiSsid}`,
    `wifi_pass,data,string,${wifiPass}`,
    `mqtt_uri,data,string,${mqttUri}`,
    `unit_id,data,string,${unitId}`,
    `api_key,data,string,${apiKey}`,
    '',
  ].join('\n')
}

export function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
