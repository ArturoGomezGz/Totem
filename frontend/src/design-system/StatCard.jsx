export function StatCard({ value, label, accent = 'var(--blue-700)', icon = null, style = {} }) {
  return (
    <div style={{
      background: 'var(--surface-card)', border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)', padding: 'var(--space-5)', boxShadow: 'var(--shadow-sm)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', ...style,
    }}>
      {icon && <span style={{ color: accent, display: 'inline-flex' }}>{icon}</span>}
      <span style={{
        fontFamily: 'var(--font-mono)', fontWeight: 'var(--weight-semibold)',
        fontSize: 'var(--text-2xl)', lineHeight: 1, color: accent,
        letterSpacing: 'var(--tracking-tight)',
      }}>
        {value}
      </span>
      <span style={{
        fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)',
        fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
        letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase',
      }}>
        {label}
      </span>
    </div>
  )
}
