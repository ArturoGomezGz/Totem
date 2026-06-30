import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Alert, Badge, Select } from '../design-system'
import AppShell from '../components/AppShell'
import TelegramLink from '../components/TelegramLink'
import { useOrg } from '../contexts/OrgContext'

const sectionTitle = {
  fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)',
  fontSize: 'var(--text-base)', color: 'var(--text-strong)',
  marginBottom: 'var(--space-1)',
}

const sectionDesc = {
  fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)',
  color: 'var(--text-muted)', marginBottom: 'var(--space-5)',
}

function Section({ title, description, children }) {
  return (
    <section style={{ paddingBottom: 'var(--space-7)', borderBottom: '1px solid var(--border-subtle)' }}>
      <h3 style={sectionTitle}>{title}</h3>
      {description && <p style={sectionDesc}>{description}</p>}
      {children}
    </section>
  )
}

function DisabledRow({ label, hint }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: 'var(--space-4)', background: 'var(--surface-fill)',
      borderRadius: 'var(--radius-md)', opacity: 0.6,
    }}>
      <div>
        <p style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--text-strong)', marginBottom: hint ? 'var(--space-1)' : 0 }}>
          {label}
        </p>
        {hint && <p style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{hint}</p>}
      </div>
      <Badge tone="neutral">Próximamente</Badge>
    </div>
  )
}

export default function SettingsPage() {
  const navigate                                 = useNavigate()
  const { orgs, activeOrg, activeOrgId, switchOrg } = useOrg()

  const [selectedOrgId, setSelectedOrgId] = useState(activeOrgId ?? '')
  const [switchMsg, setSwitchMsg]         = useState(null)

  const handleOrgSwitch = () => {
    switchOrg(selectedOrgId)
    navigate('/units')
  }

  return (
    <AppShell>
      <h2 style={{
        fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)',
        fontSize: 'var(--text-xl)', color: 'var(--text-strong)',
        marginBottom: 'var(--space-7)',
      }}>
        Configuración
      </h2>

      <div style={{ maxWidth: 600, display: 'flex', flexDirection: 'column', gap: 'var(--space-7)' }}>

        {/* ── Organización activa ── */}
        <Section
          title="Organización activa"
          description="Determina qué unidades y perfiles ves en la aplicación. Puedes cambiarla en cualquier momento."
        >
          {activeOrg && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)' }}>
                Activa ahora
              </span>
              <p style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-base)', color: 'var(--text-strong)', marginTop: 'var(--space-2)' }}>
                {activeOrg.name}
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
            <Select
              label="Cambiar a"
              style={{ flex: 1 }}
              value={selectedOrgId}
              onChange={e => { setSelectedOrgId(e.target.value); setSwitchMsg(null) }}
            >
              <option value="">Sin organización activa</option>
              {orgs.map(org => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </Select>
            <Button
              variant="primary"
              onClick={handleOrgSwitch}
              disabled={selectedOrgId === (activeOrgId ?? '')}
              style={{ flexShrink: 0 }}
            >
              Cambiar
            </Button>
          </div>

          {switchMsg && <Alert tone="success" style={{ marginTop: 'var(--space-3)' }}>{switchMsg}</Alert>}

          <div style={{ marginTop: 'var(--space-4)' }}>
            <Button variant="ghost" size="sm" onClick={() => navigate('/organizations')}>
              Gestionar organizaciones
            </Button>
          </div>
        </Section>

        {/* ── Notificaciones ── */}
        <Section
          title="Notificaciones"
          description="Configura cómo quieres recibir alertas del sistema."
        >
          <Card style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-5)' }}>
            <TelegramLink />
          </Card>
          <DisabledRow
            label="Notificaciones por correo"
            hint="Recibe alertas críticas en tu dirección de correo electrónico."
          />
        </Section>

        {/* ── Cuenta ── */}
        <Section
          title="Cuenta"
          description="Información y seguridad de tu cuenta."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <DisabledRow label="Cambiar contraseña" hint="Actualiza la contraseña de acceso a tu cuenta." />
            <DisabledRow label="Cambiar correo electrónico" hint="Modifica la dirección de correo asociada a tu cuenta." />
          </div>
        </Section>

        {/* ── Visualización ── */}
        <Section
          title="Visualización"
          description="Preferencias de apariencia del sistema."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <DisabledRow label="Tema" hint="Alterna entre el tema claro y oscuro." />
            <DisabledRow label="Idioma" hint="Cambia el idioma de la interfaz." />
          </div>
        </Section>

      </div>
    </AppShell>
  )
}
