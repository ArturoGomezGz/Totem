import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useOrg } from '../contexts/OrgContext'

export default function Navbar({ right = null }) {
  const { t }             = useTranslation()
  const navigate          = useNavigate()
  const { orgs, activeOrg, switchOrg } = useOrg()
  const [open, setOpen]   = useState(false)
  const dropdownRef       = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSwitch = (org) => {
    switchOrg(org.id)
    navigate('/units')
    setOpen(false)
  }

  return (
    <header style={{
      background: 'var(--blue-900)',
      height: 'var(--navbar-height)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 var(--space-5)',
      gap: 'var(--space-5)',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      boxShadow: '0 2px 8px rgba(0,58,92,0.3)',
      flexShrink: 0,
    }}>

      {/* Logo */}
      <button
        onClick={() => navigate('/units')}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-extrabold)',
          fontSize: 'var(--text-lg)', color: 'var(--white)',
          letterSpacing: 'var(--tracking-caps)', flexShrink: 0,
        }}
      >
        TOTEM
      </button>

      {/* Org dropdown */}
      <div ref={dropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 'var(--radius-sm)', padding: '6px 12px',
            cursor: 'pointer', color: 'var(--white)',
            fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)',
            transition: 'background var(--duration-base) var(--ease-standard)',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
        >
          <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeOrg?.name ?? t('nav.noOrg')}
          </span>
          <span style={{ fontSize: 10, opacity: 0.7, flexShrink: 0 }}>▾</span>
        </button>

        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 8px)', left: 0,
            background: 'var(--white)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
            minWidth: 220, zIndex: 200, overflow: 'hidden',
          }}>
            {orgs.length > 0 ? (
              <div style={{ padding: 'var(--space-2) 0' }}>
                {orgs.map(org => {
                  const isActive = org.id === activeOrg?.id
                  return (
                    <button
                      key={org.id}
                      onClick={() => handleSwitch(org)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        width: '100%', padding: 'var(--space-3) var(--space-4)',
                        background: isActive ? 'var(--blue-050)' : 'none',
                        border: 'none', cursor: 'pointer', textAlign: 'left',
                        fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)',
                        color: isActive ? 'var(--blue-900)' : 'var(--text-body)',
                        fontWeight: isActive ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                      }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface-fill)' }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'none' }}
                    >
                      {org.name}
                      {isActive && <span style={{ color: 'var(--blue-700)', fontSize: 12, fontWeight: 700 }}>✓</span>}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p style={{ padding: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                {t('nav.noOrgs')}
              </p>
            )}
            <div style={{ borderTop: '1px solid var(--border-subtle)', padding: 'var(--space-2) 0' }}>
              <button
                onClick={() => { navigate('/organizations/new'); setOpen(false) }}
                style={dropdownItem}
              >
                {t('nav.newOrg')}
              </button>
              <button
                onClick={() => { navigate('/organizations'); setOpen(false) }}
                style={{ ...dropdownItem, color: 'var(--text-muted)' }}
              >
                {t('nav.manageOrgs')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Spacer */}
      <span style={{ flex: 1 }} />

      {/* Right slot (connection badge, etc.) */}
      {right && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {right}
        </div>
      )}

      {/* Ajustes */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexShrink: 0 }}>
        <button onClick={() => navigate('/settings')} style={navBtn}>{t('nav.settings')}</button>
      </div>

    </header>
  )
}

const navBtn = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'rgba(255,255,255,0.65)', fontSize: 'var(--text-sm)',
  fontFamily: 'var(--font-body)', padding: 0,
  transition: 'color var(--duration-base) var(--ease-standard)',
}

const dropdownItem = {
  display: 'block', width: '100%', padding: 'var(--space-3) var(--space-4)',
  background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
  fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)', color: 'var(--text-body)',
}
