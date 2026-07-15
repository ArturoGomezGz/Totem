import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useOrg } from '../contexts/OrgContext'

const SECTIONS = [
  { id: 'units',    labelKey: 'nav.units',    path: '/units'    },
  { id: 'profiles', labelKey: 'nav.profiles', path: '/profiles' },
  { id: 'firmware', labelKey: 'nav.firmware', path: '/firmware', adminOnly: true },
]

export default function Subnav() {
  const { t }          = useTranslation()
  const { pathname }  = useLocation()
  const navigate      = useNavigate()
  const { activeOrg } = useOrg()

  const sections = SECTIONS.filter(s => !s.adminOnly || activeOrg?.role === 'admin')

  return (
    <nav style={{
      background: 'var(--white)',
      borderBottom: '1px solid var(--border-subtle)',
      display: 'flex',
      alignItems: 'flex-end',
      padding: '0 var(--space-5)',
      position: 'sticky',
      top: 'var(--navbar-height)',
      zIndex: 90,
      boxShadow: 'var(--shadow-xs)',
      flexShrink: 0,
    }}>
      {sections.map(s => {
        const active = pathname === s.path || pathname.startsWith(s.path + '/')
        return (
          <button
            key={s.id}
            onClick={() => navigate(s.path)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              fontWeight: active ? 'var(--weight-semibold)' : 'var(--weight-medium)',
              fontSize: 'var(--text-sm)',
              color: active ? 'var(--blue-900)' : 'var(--text-muted)',
              padding: '0 var(--space-1)',
              height: 44,
              marginRight: 'var(--space-5)',
              borderBottom: `2px solid ${active ? 'var(--blue-700)' : 'transparent'}`,
              marginBottom: -1,
              transition: 'color var(--duration-base) var(--ease-standard), border-color var(--duration-base) var(--ease-standard)',
            }}
          >
            {t(s.labelKey)}
          </button>
        )
      })}
    </nav>
  )
}
