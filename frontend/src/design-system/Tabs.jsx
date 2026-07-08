import { useState, useRef, useEffect, useCallback } from 'react'

export function Tabs({ tabs = [], value, defaultValue, onChange, style = {} }) {
  const [internal, setInternal] = useState(defaultValue ?? (tabs[0] && tabs[0].id))
  const [canScrollRight, setCanScrollRight] = useState(false)
  const scrollerRef = useRef(null)
  const active = value ?? internal
  const select = (id) => { setInternal(id); onChange && onChange(id) }

  const updateFade = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setCanScrollRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 4)
  }, [])

  useEffect(() => {
    updateFade()
    const el = scrollerRef.current
    if (!el) return
    el.addEventListener('scroll', updateFade, { passive: true })
    window.addEventListener('resize', updateFade)
    return () => {
      el.removeEventListener('scroll', updateFade)
      window.removeEventListener('resize', updateFade)
    }
  }, [updateFade, tabs.length])

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={scrollerRef}
        role="tablist"
        style={{
          display: 'flex', gap: 'var(--space-4)', borderBottom: '2px solid var(--border-subtle)',
          overflowX: 'auto', scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch',
          ...style,
        }}
      >
        {tabs.map((t) => {
          const on = t.id === active
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={on}
              onClick={() => select(t.id)}
              style={{
                border: 'none', background: 'none', cursor: 'pointer', flexShrink: 0,
                scrollSnapAlign: 'start', whiteSpace: 'nowrap',
                fontFamily: 'var(--font-display)', fontSize: 'var(--text-base)',
                fontWeight: on ? 'var(--weight-semibold)' : 'var(--weight-medium)',
                color: on ? 'var(--blue-900)' : 'var(--text-muted)',
                padding: '0 0 12px', marginBottom: '-2px',
                borderBottom: `2px solid ${on ? 'var(--blue-700)' : 'transparent'}`,
                transition: 'color var(--duration-base) var(--ease-standard), border-color var(--duration-base) var(--ease-standard)',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {canScrollRight && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute', top: 0, right: 0, bottom: '2px', width: 32,
            background: 'linear-gradient(to right, transparent, var(--surface-fill))',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}
