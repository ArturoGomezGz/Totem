import { useState } from 'react'

export function Tabs({ tabs = [], value, defaultValue, onChange, style = {} }) {
  const [internal, setInternal] = useState(defaultValue ?? (tabs[0] && tabs[0].id))
  const active = value ?? internal
  const select = (id) => { setInternal(id); onChange && onChange(id) }
  return (
    <div role="tablist" style={{ display: 'flex', gap: 'var(--space-4)', borderBottom: '2px solid var(--border-subtle)', ...style }}>
      {tabs.map((t) => {
        const on = t.id === active
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => select(t.id)}
            style={{
              border: 'none', background: 'none', cursor: 'pointer',
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
  )
}
