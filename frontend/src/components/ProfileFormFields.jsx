import { Input, Select } from '../design-system'

const eyebrow = {
  fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
  fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
  marginBottom: 'var(--space-3)', display: 'block',
}

// Etiquetas legibles para claves conocidas de irrigation_params. Cualquier
// clave nueva (de un método agregado al catálogo sin tocar el frontend) cae
// al fallback humanizado — no bloquea agregar métodos vía el catálogo.
const PARAM_LABELS = {
  threshold_vpd_kpa: 'Umbral de VPD (kPa)',
  cycle_duration_s: 'Duración del ciclo (s)',
  base_duration_s: 'Duración base del ciclo (s)',
  min_interval_s: 'Intervalo mínimo entre ciclos (s)',
}

function humanizeKey(key) {
  return PARAM_LABELS[key] ?? key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
}

export const EMPTY_PROFILE_FORM = {
  name: '', species: '',
  temp_min: '', temp_max: '',
  humidity_min: '', humidity_max: '',
  light_min: '', light_max: '',
  irrigation_method: '',
}

export function profileToForm(p) {
  const form = {
    name: p.name ?? '', species: p.species ?? '',
    temp_min: p.temp_min     != null ? String(p.temp_min)     : '',
    temp_max: p.temp_max     != null ? String(p.temp_max)     : '',
    humidity_min: p.humidity_min != null ? String(p.humidity_min) : '',
    humidity_max: p.humidity_max != null ? String(p.humidity_max) : '',
    light_min: p.light_min   != null ? String(p.light_min)   : '',
    light_max: p.light_max   != null ? String(p.light_max)   : '',
    irrigation_method: p.irrigation_method ?? '',
  }
  for (const [key, value] of Object.entries(p.irrigation_params ?? {})) {
    form[key] = value != null ? String(value) : ''
  }
  return form
}

export function toFloat(val) {
  const n = parseFloat(val)
  return isNaN(n) ? null : n
}

// `methods` es el catálogo de GET /irrigation-methods (lo obtiene la página
// contenedora) — se necesita aquí para saber qué claves de `form` pertenecen
// a irrigation_params del método elegido.
export function formToProfileBody(form, organization_id, methods) {
  const method = methods.find(m => m.key === form.irrigation_method)
  const schemaProps = method?.params_schema?.properties ?? {}

  const irrigation_params = {}
  for (const key of Object.keys(schemaProps)) {
    const value = toFloat(form[key])
    if (value === null) throw new Error(`Falta o no es numérico el parámetro "${humanizeKey(key)}"`)
    irrigation_params[key] = value
  }

  return {
    organization_id,
    name: form.name,
    species: form.species || null,
    temp_min: toFloat(form.temp_min),     temp_max: toFloat(form.temp_max),
    humidity_min: toFloat(form.humidity_min), humidity_max: toFloat(form.humidity_max),
    light_min: toFloat(form.light_min),   light_max: toFloat(form.light_max),
    irrigation_method: form.irrigation_method,
    irrigation_params,
  }
}

export default function ProfileFormFields({
  form, onChange, methods, methodsError, autoFocusName = false,
}) {
  const handleChange = (field) => (e) => onChange(field, e.target.value)

  const selectedMethod = methods.find(m => m.key === form.irrigation_method)
  const paramKeys = Object.keys(selectedMethod?.params_schema?.properties ?? {})

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <span style={eyebrow}>Identificación</span>
        <Input label="Nombre *" value={form.name} onChange={handleChange('name')} autoFocus={autoFocusName} required />
        <Input label="Especie" value={form.species} onChange={handleChange('species')} hint="Ej: Lactuca sativa, Ocimum basilicum" />
      </div>

      <div>
        <span style={eyebrow}>Rangos óptimos de sensores</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-3)' }}>
          <Input label="Temp. mínima (°C)"    value={form.temp_min}     onChange={handleChange('temp_min')}     type="number" step="any" />
          <Input label="Temp. máxima (°C)"    value={form.temp_max}     onChange={handleChange('temp_max')}     type="number" step="any" />
          <Input label="Humedad mínima (%)"   value={form.humidity_min} onChange={handleChange('humidity_min')} type="number" step="any" />
          <Input label="Humedad máxima (%)"   value={form.humidity_max} onChange={handleChange('humidity_max')} type="number" step="any" />
          <Input label="Luz mínima (PAR)"     value={form.light_min}    onChange={handleChange('light_min')}    type="number" step="any" />
          <Input label="Luz máxima (PAR)"     value={form.light_max}    onChange={handleChange('light_max')}    type="number" step="any" />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <span style={eyebrow}>Parámetros de riego</span>

        {methodsError && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-danger)' }}>{methodsError}</p>}

        <Select
          label="Método de riego *"
          value={form.irrigation_method}
          onChange={handleChange('irrigation_method')}
          required
        >
          <option value="">Selecciona un método</option>
          {methods.map(m => <option key={m.key} value={m.key}>{m.name}</option>)}
        </Select>

        {selectedMethod?.description && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'calc(-1 * var(--space-2))' }}>
            {selectedMethod.description}
          </p>
        )}

        {paramKeys.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-3)' }}>
            {paramKeys.map(key => (
              <Input
                key={key}
                label={`${humanizeKey(key)} *`}
                value={form[key] ?? ''}
                onChange={handleChange(key)}
                type="number" step="any" required
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
