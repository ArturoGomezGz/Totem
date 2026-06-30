import { useState } from 'react'

export function Card({ as = 'div', interactive = false, accent = null, padding = 'var(--space-5)', children, style = {}, ...rest }) {
  const [hover, setHover] = useState(false)
  const Tag = as
  return (
    <Tag
      onMouseEnter={() => interactive && setHover(true)}
      onMouseLeave={() => interactive && setHover(false)}
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        borderTop: accent ? `3px solid ${accent}` : '1px solid var(--border-subtle)',
        boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        transform: hover ? 'translateY(-2px)' : 'none',
        transition: 'box-shadow var(--duration-base) var(--ease-standard), transform var(--duration-base) var(--ease-standard)',
        padding,
        cursor: interactive ? 'pointer' : 'default',
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  )
}
