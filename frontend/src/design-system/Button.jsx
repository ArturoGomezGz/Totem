import { useState } from 'react'

const sizes = {
  sm: { padding: '6px 14px', fontSize: 'var(--text-sm)', height: 34 },
  md: { padding: '9px 20px', fontSize: 'var(--text-base)', height: 42 },
  lg: { padding: '13px 28px', fontSize: 'var(--text-md)', height: 52 },
}

const palettes = {
  primary: { bg: 'var(--blue-700)', bgHover: 'var(--blue-800)', fg: '#fff' },
  navy:    { bg: 'var(--blue-900)', bgHover: 'var(--blue-950)', fg: '#fff' },
  teal:    { bg: 'var(--teal-500)', bgHover: 'var(--teal-600)', fg: '#fff' },
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
  iconLeft = null,
  iconRight = null,
  children,
  style = {},
  ...rest
}) {
  const [hover, setHover] = useState(false)
  const [active, setActive] = useState(false)
  const s = sizes[size] || sizes.md
  const isOutline = variant === 'outline'
  const isGhost = variant === 'ghost'
  const pal = palettes[variant] || palettes.primary

  let base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 'var(--space-2)', whiteSpace: 'nowrap',
    fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
    fontSize: s.fontSize, lineHeight: 1, letterSpacing: '0.01em',
    padding: s.padding, minHeight: s.height,
    borderRadius: 'var(--radius-sm)',
    border: '1px solid transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard), transform var(--duration-fast) var(--ease-standard)',
    width: fullWidth ? '100%' : 'auto',
    opacity: disabled ? 0.5 : 1,
    transform: active && !disabled ? 'scale(0.98)' : 'none',
  }

  if (isOutline) {
    base = { ...base, background: hover && !disabled ? 'var(--blue-050)' : 'transparent',
      color: 'var(--blue-700)', borderColor: 'var(--blue-700)' }
  } else if (isGhost) {
    base = { ...base, background: hover && !disabled ? 'var(--ink-100)' : 'transparent',
      color: 'var(--blue-700)', borderColor: 'transparent' }
  } else {
    base = { ...base, background: hover && !disabled ? pal.bgHover : pal.bg,
      color: pal.fg, boxShadow: hover && !disabled ? 'var(--shadow-md)' : 'var(--shadow-xs)' }
  }

  return (
    <button
      disabled={disabled}
      style={{ ...base, ...style }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setActive(false) }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  )
}
