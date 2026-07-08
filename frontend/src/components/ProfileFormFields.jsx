import { Input, Select } from '../design-system'

const PLACEHOLDER_PARAMS = `{
  "threshold_pn": 8.5,
  "cycle_duration_s": 30,
  "min_interval_s": 900
}`

// Único método implementado hoy en firmware/simulador (ver docs/transversal/crop-profile.md);
// fixed_timer y lookup_table solo existen como ejemplos ilustrativos en la documentación.
const KNOWN_METHODS = {
  pn_threshold: ['threshold_pn', 'cycle_duration_s', 'min_interval_s'],
}

const eyebrow = {
  fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
  fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
  marginBottom: 'var(--space-3)', display: 'block',
}

export const EMPTY_PROFILE_FORM = {
  name: '', species: '',
  temp_min: '', temp_max: '',
  humidity_min: '', humidity_max: '',
  light_min: '', light_max: '',
  co2_min: '', co2_max: '',
  irrigation_method: '', irrigation_params: '',
}

export function profileToForm(p) {
  return {
    name: p.name ?? '', species: p.species ?? '',
    temp_min: p.temp_min     != null ? String(p.temp_min)     : '',
    temp_max: p.temp_max     != null ? String(p.temp_max)     : '',
    humidity_min: p.humidity_min != null ? String(p.humidity_min) : '',
    humidity_max: p.humidity_max != null ? String(p.humidity_max) : '',
    light_min: p.light_min   != null ? String(p.light_min)   : '',
    light_max: p.light_max   != null ? String(p.light_max)   : '',
    co2_min: p.co2_min       != null ? String(p.co2_min)     : '',
    co2_max: p.co2_max       != null ? String(p.co2_max)     : '',
    irrigation_method: p.irrigation_method ?? '',
    irrigation_params: JSON.stringify(p.irrigation_params, null, 2),
  }
}

export function toFloat(val) {
  const n = parseFloat(val)
  return isNaN(n) ? null : n
}

export function formToProfileBody(form, organization_id) {
  return {
    organization_id,
    name: form.name,
    species: form.species || null,
    temp_min: toFloat(form.temp_min),     temp_max: toFloat(form.temp_max),
    humidity_min: toFloat(form.humidity_min), humidity_max: toFloat(form.humidity_max),
    light_min: toFloat(form.light_min),   light_max: toFloat(form.light_max),
    co2_min: toFloat(form.co2_min),       co2_max: toFloat(form.co2_max),
    irrigation_method: form.irrigation_method,
    irrigation_params: JSON.parse(form.irrigation_params),
  }
}

export default function ProfileFormFields({
  form, onChange, paramsError, paramsFocus, onParamsFocus, onParamsBlur, autoFocusName = false,
}) {
  const handleChange = (field) => (e) => onChange(field, e.target.value)

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
          <Input label="CO₂ mínimo (ppm)"     value={form.co2_min}      onChange={handleChange('co2_min')}      type="number" step="any" />
          <Input label="CO₂ máximo (ppm)"     value={form.co2_max}      onChange={handleChange('co2_max')}      type="number" step="any" />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <span style={eyebrow}>Parámetros de riego</span>
        <Select
          label="Método de riego *"
          value={form.irrigation_method}
          onChange={handleChange('irrigation_method')}
          required
        >
          <option value="">Selecciona un método</option>
          <option value="pn_threshold">pn_threshold</option>
          {form.irrigation_method && !KNOWN_METHODS[form.irrigation_method] && (
            <option value={form.irrigation_method}>{form.irrigation_method} (no reconocido)</option>
          )}
        </Select>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <label style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-strong)' }}>
            Parámetros del método (JSON) *
          </label>
          <textarea
            value={form.irrigation_params}
            onChange={handleChange('irrigation_params')}
            onFocus={onParamsFocus}
            onBlur={onParamsBlur}
            placeholder={PLACEHOLDER_PARAMS}
            required
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--text-strong)',
              background: 'var(--white)',
              border: `1px solid ${paramsError ? 'var(--status-danger)' : paramsFocus ? 'var(--blue-700)' : 'var(--border-default)'}`,
              borderRadius: 'var(--radius-sm)', padding: '10px 14px', minHeight: 120,
              outline: 'none', width: '100%', boxSizing: 'border-box',
              boxShadow: paramsFocus ? 'var(--focus-ring)' : 'none',
              transition: 'border-color var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard)',
            }}
          />
          <span style={{ fontSize: 'var(--text-sm)', color: paramsError ? 'var(--status-danger)' : 'var(--text-muted)' }}>
            {paramsError
              ? paramsError
              : form.irrigation_method
                ? (KNOWN_METHODS[form.irrigation_method]
                    ? `Claves esperadas: ${KNOWN_METHODS[form.irrigation_method].join(', ')}`
                    : 'Método no reconocido por el sistema; verifica el nombre.')
                : 'Selecciona un método de riego para ver las claves esperadas.'}
          </span>
        </div>
      </div>
    </>
  )
}
