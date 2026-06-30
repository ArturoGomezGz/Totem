import Navbar from './Navbar'
import Subnav from './Subnav'

export default function AppShell({ children, wide = false, navRight = null }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--surface-fill)' }}>
      <Navbar right={navRight} />
      <Subnav />
      <main style={{
        flex: 1,
        width: '100%',
        maxWidth: wide ? 1100 : 760,
        margin: '0 auto',
        padding: 'var(--space-6) var(--space-4) var(--space-9)',
        boxSizing: 'border-box',
      }}>
        {children}
      </main>
    </div>
  )
}
