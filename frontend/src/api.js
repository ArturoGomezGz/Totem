const BASE = '/api/v1'

function getToken() {
  return localStorage.getItem('access_token')
}

export function saveTokens(access_token, refresh_token) {
  localStorage.setItem('access_token', access_token)
  if (refresh_token) localStorage.setItem('refresh_token', refresh_token)
}

export function clearTokens() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401) {
    clearTokens()
    window.location.href = '/login'
    return
  }

  const data = res.status === 204 ? null : await res.json()

  if (!res.ok) {
    throw new Error(data?.detail || `HTTP ${res.status}`)
  }

  return data
}

export const api = {
  register:         (email, password)    => request('POST', '/auth/register', { email, password }),
  login:            (email, password)    => request('POST', '/auth/login',    { email, password }),
  refresh:          (refresh_token)      => request('POST', '/auth/refresh',   { refresh_token }),
  logout:           (refresh_token)      => request('POST', '/auth/logout',   { refresh_token }),

  getOrganizations: ()                   => request('GET',  '/organizations'),
  createOrganization: (name)             => request('POST', '/organizations',  { name }),

  getUnits:         (organization_id)    => request('GET',  `/units?organization_id=${organization_id}`),
  createUnit:       (body)               => request('POST', '/units', body),
  getUnit:          (unit_id)            => request('GET',  `/units/${unit_id}`),
  getUnitState:     (unit_id)            => request('GET',  `/units/${unit_id}/state`),

  sendCommand:      (unit_id, type)      => request('POST', `/units/${unit_id}/commands`, { type }),

  getReadings: (unit_id, params = {}) => {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null)))
    return request('GET', `/units/${unit_id}/readings?${q}`)
  },
  getEvents: (unit_id, params = {}) => {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null)))
    return request('GET', `/units/${unit_id}/events?${q}`)
  },
  getAlerts: (params = {}) => {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null)))
    return request('GET', `/alerts?${q}`)
  },
}
