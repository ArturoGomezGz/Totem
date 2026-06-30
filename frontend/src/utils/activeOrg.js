const KEY = 'totem:active_org_id'

export const getActiveOrgId = ()     => localStorage.getItem(KEY)
export const setActiveOrgId = (id)   => localStorage.setItem(KEY, id)
export const clearActiveOrgId = ()   => localStorage.removeItem(KEY)
