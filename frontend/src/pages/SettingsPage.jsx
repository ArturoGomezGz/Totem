import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, clearTokens } from '../api'
import { clearActiveOrgId } from '../utils/activeOrg'
import { Button, Card, Badge, Select } from '../design-system'
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
      padding: 'var(--space-3) var(--space-4)', opacity: 0.55,
    }}>
      <div>
        <p style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)', color: 'var(--text-strong)', marginBottom: hint ? 'var(--space-1)' : 0 }}>
          {label}
        </p>
        {hint && <p style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{hint}</p>}
      </div>
      <ComingSoonBadge />
    </div>
  )
}

function ComingSoonBadge() {
  const { t } = useTranslation()
  return <Badge tone="neutral">{t('settings.comingSoon')}</Badge>
}

export default function SettingsPage() {
  const { t, i18n }                              = useTranslation()
  const navigate                                 = useNavigate()
  const { orgs, activeOrg, activeOrgId, switchOrg } = useOrg()

  const [selectedOrgId, setSelectedOrgId] = useState(activeOrgId ?? '')

  const handleOrgSwitch = () => {
    switchOrg(selectedOrgId)
    navigate('/units')
  }

  const logout = async () => {
    const refresh_token = localStorage.getItem('refresh_token')
    if (refresh_token) {
      try { await api.logout(refresh_token) } catch { /* silencioso */ }
    }
    clearTokens()
    clearActiveOrgId()
    navigate('/login')
  }

  return (
    <AppShell>
      <h2 style={{
        fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-bold)',
        fontSize: 'var(--text-xl)', color: 'var(--text-strong)',
        marginBottom: 'var(--space-7)',
      }}>
        {t('settings.title')}
      </h2>

      <div style={{ maxWidth: 600, display: 'flex', flexDirection: 'column', gap: 'var(--space-7)' }}>

        {/* ── Organización activa ── */}
        <Section
          title={t('settings.activeOrg.title')}
          description={t('settings.activeOrg.description')}
        >
          {activeOrg && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)' }}>
                {t('settings.activeOrg.activeNow')}
              </span>
              <p style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-base)', color: 'var(--text-strong)', marginTop: 'var(--space-2)' }}>
                {activeOrg.name}
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
            <Select
              label={t('settings.activeOrg.switchTo')}
              style={{ flex: 1 }}
              value={selectedOrgId}
              onChange={e => setSelectedOrgId(e.target.value)}
            >
              <option value="">{t('settings.activeOrg.noActiveOrg')}</option>
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
              {t('settings.activeOrg.switchButton')}
            </Button>
          </div>

          <div style={{ marginTop: 'var(--space-4)' }}>
            <Button variant="ghost" size="sm" onClick={() => navigate('/organizations')}>
              {t('settings.activeOrg.manageOrgs')}
            </Button>
          </div>
        </Section>

        {/* ── Notificaciones ── */}
        <Section
          title={t('settings.notifications.title')}
          description={t('settings.notifications.description')}
        >
          <Card style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-5)' }}>
            <TelegramLink />
          </Card>
          <DisabledRow
            label={t('settings.notifications.email')}
            hint={t('settings.notifications.emailHint')}
          />
        </Section>

        {/* ── Cuenta ── */}
        <Section
          title={t('settings.account.title')}
          description={t('settings.account.description')}
        >
          <div style={{ marginBottom: 'var(--space-5)' }}>
            <Button variant="danger" size="sm" onClick={logout}>
              {t('settings.account.logout')}
            </Button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <DisabledRow label={t('settings.account.changePassword')} hint={t('settings.account.changePasswordHint')} />
            <DisabledRow label={t('settings.account.changeEmail')} hint={t('settings.account.changeEmailHint')} />
          </div>
        </Section>

        {/* ── Visualización ── */}
        <Section
          title={t('settings.display.title')}
          description={t('settings.display.description')}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <DisabledRow label={t('settings.display.theme')} hint={t('settings.display.themeHint')} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3) var(--space-4)' }}>
              <div>
                <p style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)', color: 'var(--text-strong)', marginBottom: 'var(--space-1)' }}>
                  {t('settings.display.language')}
                </p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                  {t('settings.display.languageHint')}
                </p>
              </div>
              <Select
                value={i18n.resolvedLanguage}
                onChange={e => i18n.changeLanguage(e.target.value)}
                style={{ minWidth: 140 }}
              >
                <option value="es">{t('settings.display.languageEs')}</option>
                <option value="en">{t('settings.display.languageEn')}</option>
              </Select>
            </div>
          </div>
        </Section>

      </div>
    </AppShell>
  )
}
