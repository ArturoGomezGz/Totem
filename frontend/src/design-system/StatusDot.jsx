const tones = {
  success: 'var(--green-500)',
  warning: 'var(--status-warning)',
  neutral: 'var(--ink-300)',
}

export function StatusDot({ tone = 'neutral', title, style = {} }) {
  return (
    <span
      title={title}
      style={{
        width: 10, height: 10, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
        background: tones[tone] || tones.neutral,
        boxShadow: tone === 'success' ? '0 0 0 3px var(--green-100)' : 'none',
        ...style,
      }}
    />
  )
}
