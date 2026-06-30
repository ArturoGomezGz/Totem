const tones = {
  navy:    { bg: 'var(--blue-900)',          fg: '#fff' },
  blue:    { bg: 'var(--blue-700)',          fg: '#fff' },
  teal:    { bg: 'var(--teal-500)',          fg: '#fff' },
  green:   { bg: 'var(--green-500)',         fg: '#fff' },
  lime:    { bg: 'var(--lime-500)',          fg: 'var(--ink-900)' },
  neutral: { bg: 'var(--blue-050)',          fg: 'var(--blue-900)' },
  success: { bg: 'var(--status-success-fill)', fg: 'var(--green-600)' },
  info:    { bg: 'var(--status-info-fill)',    fg: 'var(--blue-800)' },
  warning: { bg: 'var(--status-warning-fill)', fg: '#8a6414' },
  danger:  { bg: 'var(--status-danger-fill)',  fg: '#8f322b' },
}

export function Badge({ tone = 'neutral', children, style = {} }) {
  const t = tones[tone] || tones.neutral
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)',
      fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
      fontSize: 'var(--text-xs)', letterSpacing: 'var(--tracking-wide)', textTransform: 'uppercase',
      padding: '3px 10px', borderRadius: 'var(--radius-pill)',
      background: t.bg, color: t.fg, ...style,
    }}>
      {children}
    </span>
  )
}
