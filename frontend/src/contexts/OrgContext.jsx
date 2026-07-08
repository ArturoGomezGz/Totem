import { createContext, useContext, useState, useEffect } from 'react'
import { api } from '../api'
import { getActiveOrgId, setActiveOrgId, clearActiveOrgId } from '../utils/activeOrg'

const OrgContext = createContext(null)

export function OrgProvider({ children }) {
  const [orgs, setOrgs]               = useState([])
  const [activeOrgId, setActiveOrgIdState] = useState(getActiveOrgId() ?? '')
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    api.getOrganizations()
      .then(data => {
        setOrgs(data)
        // Si la org guardada ya no existe para este usuario, limpiarla
        if (activeOrgId && !data.find(o => o.id === activeOrgId)) {
          clearActiveOrgId()
          setActiveOrgIdState('')
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line

  const activeOrg = orgs.find(o => o.id === activeOrgId) ?? null

  const switchOrg = (id) => {
    setActiveOrgId(id)
    setActiveOrgIdState(id)
  }

  const addOrg = (org) => {
    setOrgs(prev => [...prev, org])
    switchOrg(org.id)
  }

  const updateOrgName = (id, name) => {
    setOrgs(prev => prev.map(o => o.id === id ? { ...o, name } : o))
  }

  return (
    <OrgContext.Provider value={{ orgs, activeOrg, activeOrgId, switchOrg, addOrg, updateOrgName, loading }}>
      {children}
    </OrgContext.Provider>
  )
}

export const useOrg = () => {
  const ctx = useContext(OrgContext)
  if (!ctx) throw new Error('useOrg must be inside OrgProvider')
  return ctx
}
