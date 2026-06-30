const tones = {
  info:    { bg: 'var(--status-info-fill)',    bar: 'var(--status-info)',    fg: 'var(--blue-800)' },
  success: { bg: 'var(--status-success-fill)', bar: 'var(--status-success)', fg: 'var(--green-600)' },
  warning: { bg: 'var(--status-warning-fill)', bar: 'var(--status-warning)', fg: '#8a6414' },
  danger:  { bg: 'var(--status-danger-fill)',  bar: 'var(--status-danger)',  fg: '#8f322b' },
}

export function Alert({ tone = 'info', title, icon = null, onClose = null, children, style = {} }) {
  const t = tones[tone] || tones.info
  return (
    <div role="status" style={{
      display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start',
      background: t.bg, borderLeft: `4px solid ${t.bar}`,
      borderRadius: 'var(--radius-sm)', padding: 'var(--space-4)',
      fontFamily: 'var(--font-body)', ...style,
    }}>
      {icon && <span style={{ color: t.bar, display: 'inline-flex', marginTop: 2 }}>{icon}</span>}
      <div style={{ flex: 1 }}>
        {title && (
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)', color: t.fg, marginBottom: children ? 4 : 0 }}>
            {title}
          </div>
        )}
        {children && (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-body)', lineHeight: 'var(--leading-normal)' }}>
            {children}
          </div>
        )}
      </div>
      {onClose && (
        <button onClick={onClose} aria-label="Cerrar" style={{ border: 'none', background: 'none', cursor: 'pointer', color: t.fg, fontSize: 18, lineHeight: 1, padding: 0 }}>
          ×
        </button>
      )}
    </div>
  )
}
