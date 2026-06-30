import Navbar from './Navbar'

export default function PageLayout({ children, breadcrumb = [], navRight = null }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Navbar breadcrumb={breadcrumb} right={navRight} />
      <main style={{
        flex: 1,
        width: '100%',
        maxWidth: 'var(--container-narrow)',
        margin: '0 auto',
        padding: 'var(--space-6) var(--space-4) var(--space-8)',
      }}>
        {children}
      </main>
    </div>
  )
}
