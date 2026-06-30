import { useState, useId } from 'react'

export function Select({ label, hint, id, children, style = {}, ...rest }) {
  const [focus, setFocus] = useState(false)
  const selectId = id || useId()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', ...style }}>
      {label && (
        <label htmlFor={selectId} style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-strong)' }}>
          {label}
        </label>
      )}
      <div style={{ position: 'relative' }}>
        <select
          id={selectId}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            width: '100%', boxSizing: 'border-box', appearance: 'none',
            fontFamily: 'var(--font-body)', fontSize: 'var(--text-base)', color: 'var(--text-strong)',
            padding: '10px 38px 10px 14px', background: 'var(--white)',
            border: `1px solid ${focus ? 'var(--blue-700)' : 'var(--border-default)'}`,
            borderRadius: 'var(--radius-sm)', outline: 'none', cursor: 'pointer',
            boxShadow: focus ? 'var(--focus-ring)' : 'none',
            transition: 'border-color var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard)',
          }}
          {...rest}
        >
          {children}
        </select>
        <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)', fontSize: 12 }}>▾</span>
      </div>
      {hint && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{hint}</span>}
    </div>
  )
}
