import { useState, useId } from 'react'

export function Input({ label, hint, error, id, type = 'text', icon = null, style = {}, ...rest }) {
  const [focus, setFocus] = useState(false)
  const inputId = id || useId()
  const borderColor = error ? 'var(--status-danger)' : focus ? 'var(--blue-700)' : 'var(--border-default)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', ...style }}>
      {label && (
        <label htmlFor={inputId} style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-strong)' }}>
          {label}
        </label>
      )}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {icon && <span style={{ position: 'absolute', left: 12, color: 'var(--text-muted)', display: 'inline-flex' }}>{icon}</span>}
        <input
          id={inputId}
          type={type}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            width: '100%', boxSizing: 'border-box',
            fontFamily: 'var(--font-body)', fontSize: 'var(--text-base)', color: 'var(--text-strong)',
            padding: icon ? '10px 14px 10px 38px' : '10px 14px',
            background: 'var(--white)',
            border: `1px solid ${borderColor}`,
            borderRadius: 'var(--radius-sm)',
            outline: 'none',
            boxShadow: focus ? 'var(--focus-ring)' : 'none',
            transition: 'border-color var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard)',
          }}
          {...rest}
        />
      </div>
      {(hint || error) && (
        <span style={{ fontSize: 'var(--text-sm)', color: error ? 'var(--status-danger)' : 'var(--text-muted)' }}>
          {error || hint}
        </span>
      )}
    </div>
  )
}
