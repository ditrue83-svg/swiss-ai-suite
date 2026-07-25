// ============================================================================
// AppShell — layout autenticato: sidebar desktop, topbar+drawer mobile,
// selettore azienda (multi-tenant ready), box account con "Esci".
// Riproduce fedelmente il layout/design del prototipo.
// ============================================================================
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { NAV, isSection } from './nav';
import type { TKey } from '@/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { useToast } from '@/components/ui/Toast';
import { toUserMessage } from '@/lib/errors';
import { useT } from '@/i18n';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';

// I ruoli restano in chiave: l'etichetta si traduce al render.
const ROLE_KEY: Record<string, TKey> = { owner: 'roles.owner', admin: 'roles.admin', member: 'roles.member' };

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  return (
    <nav className="nav" aria-label={t('nav.sectionPlatform')}>
      {NAV.map((entry, i) =>
        isSection(entry) ? (
          <div className="nav-section" key={`s-${i}`}>{t(entry.sectionKey)}</div>
        ) : (
          <NavLink
            key={entry.id}
            to={entry.path}
            end={entry.path === '/'}
            className={({ isActive }) => `nav-btn${isActive ? ' active' : ''}`}
            onClick={onNavigate}
          >
            <Icon name={entry.icon} />
            <span>{t(entry.labelKey)}</span>
          </NavLink>
        ),
      )}
    </nav>
  );
}

function CompanySwitch() {
  const t = useT();
  const { memberships, activeCompany, activeCompanyId, role, setActiveCompany } = useCompany();
  if (!activeCompany) return null;
  return (
    <div className="company-switch">
      <div className="cs-label">{t('nav.activeCompany')}</div>
      <div className="cs-name">{activeCompany.legalName}</div>
      <div className="cs-meta">
        {activeCompany.canton ?? '—'} · <span className="role-chip">{role ? t(ROLE_KEY[role]) : ''}</span>
      </div>
      {memberships.length > 1 && (
        <select
          className="select-inline"
          value={activeCompanyId ?? ''}
          onChange={(e) => setActiveCompany(e.target.value)}
          aria-label={t('nav.switchCompany')}
        >
          {memberships.map((m) => (
            <option key={m.company.id} value={m.company.id}>{m.company.legalName}</option>
          ))}
        </select>
      )}
    </div>
  );
}

function AccountBox() {
  const t = useT();
  const { profile, user, signOut } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const name = profile && (profile.firstName || profile.lastName)
    ? `${profile.firstName} ${profile.lastName}`.trim()
    : (user?.email ?? 'Utente');
  const email = profile?.email ?? user?.email ?? '';
  const initials = (profile?.firstName?.[0] ?? '') + (profile?.lastName?.[0] ?? '') || (email[0] ?? 'U').toUpperCase();

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (e) {
      showToast(toUserMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="account-box">
      <div className="account-row">
        <div className="account-avatar" aria-hidden="true">{initials.toUpperCase()}</div>
        <div className="account-info">
          <div className="account-name">{name}</div>
          <div className="account-email">{email}</div>
        </div>
      </div>
      {/* La lingua si cambia dove l'utente si aspetta le impostazioni personali. */}
      <div style={{ marginBottom: 8 }}><LanguageSwitcher compact /></div>
      <div className="account-actions">
        <button className="btn btn-sm" onClick={handleSignOut} disabled={busy} aria-label={t('nav.signOutAria')}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="logout" className="ic-sm" />} {t('nav.signOut')}
        </button>
      </div>
    </div>
  );
}

export function AppShell() {
  const t = useT();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Chiudi il drawer al cambio pagina.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // Blocca lo scroll del body quando il drawer è aperto.
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  return (
    <div className="app-shell">
      {/* Topbar (mobile) */}
      <header className="topbar" role="banner">
        <button className="hamburger" aria-label={t('nav.openMenu')} aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}>
          <Icon name="menu" />
        </button>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><Icon name="logo" /></div>
          <div className="brand-name">SwissAI Suite</div>
        </div>
      </header>

      {/* Sidebar (desktop) */}
      <aside className="sidebar" aria-label={t('nav.mainNav')}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><Icon name="logo" /></div>
          <div>
            <div className="brand-name">SwissAI Suite</div>
            <div className="brand-sub">{t('brand.tagline')}</div>
          </div>
        </div>
        <CompanySwitch />
        <NavList />
        <AccountBox />
      </aside>

      {/* Drawer (mobile) */}
      <div className={`drawer-overlay${drawerOpen ? ' open' : ''}`} hidden={!drawerOpen} onClick={() => setDrawerOpen(false)} />
      <aside className={`drawer${drawerOpen ? ' open' : ''}`} aria-label={t('nav.menu')} aria-hidden={!drawerOpen}>
        <button className="drawer-close" aria-label={t('nav.closeMenu')} onClick={() => setDrawerOpen(false)}><Icon name="close" /></button>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><Icon name="logo" /></div>
          <div>
            <div className="brand-name">SwissAI Suite</div>
            <div className="brand-sub">{t('brand.tagline')}</div>
          </div>
        </div>
        <CompanySwitch />
        <NavList onNavigate={() => setDrawerOpen(false)} />
        <AccountBox />
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
