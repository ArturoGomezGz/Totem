export function StatCard({ value, unit = null, label, accent = 'var(--blue-700)', icon = null, style = {} }) {
  return (
    <div style={{
      background: 'var(--surface-card)', border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)', padding: 'var(--space-5)', boxShadow: 'var(--shadow-sm)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', ...style,
    }}>
      {icon && <span style={{ color: accent, display: 'inline-flex' }}>{icon}</span>}
      {/* Número y unidad en spans separados: la unidad es un sufijo atenuado y más
          pequeño para que no compita con el dato ni haga wrap feo cuando el número
          es largo (p.ej. "2738 ppm"). baseline + nowrap los mantiene en una línea. */}
      <span style={{
        display: 'flex', alignItems: 'baseline', gap: 'var(--space-1)',
        whiteSpace: 'nowrap',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontWeight: 'var(--weight-semibold)',
          fontSize: 'var(--text-2xl)', lineHeight: 1, color: accent,
          letterSpacing: 'var(--tracking-tight)',
        }}>
          {value}
        </span>
        {unit && (
          <span style={{
            fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-medium)',
            fontSize: 'var(--text-sm)', lineHeight: 1, color: 'var(--text-muted)',
          }}>
            {unit}
          </span>
        )}
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
