// ============================================================================
// AppShell — layout autenticato: sidebar desktop, topbar+drawer mobile,
// selettore azienda (multi-tenant ready), box account con "Esci".
// Riproduce fedelmente il layout/design del prototipo.
// ============================================================================
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { NAV, isSection } from './nav';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { useToast } from '@/components/ui/Toast';
import { toUserMessage } from '@/lib/errors';

const ROLE_LABEL: Record<string, string> = { owner: 'Titolare', admin: 'Amministratore', member: 'Collaboratore' };

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="nav" aria-label="Sezioni">
      {NAV.map((entry, i) =>
        isSection(entry) ? (
          <div className="nav-section" key={`s-${i}`}>{entry.section}</div>
        ) : (
          <NavLink
            key={entry.id}
            to={entry.path}
            end={entry.path === '/'}
            className={({ isActive }) => `nav-btn${isActive ? ' active' : ''}`}
            onClick={onNavigate}
          >
            <Icon name={entry.icon} />
            <span>{entry.label}</span>
          </NavLink>
        ),
      )}
    </nav>
  );
}

function CompanySwitch() {
  const { memberships, activeCompany, activeCompanyId, role, setActiveCompany } = useCompany();
  if (!activeCompany) return null;
  return (
    <div className="company-switch">
      <div className="cs-label">Azienda attiva</div>
      <div className="cs-name">{activeCompany.legalName}</div>
      <div className="cs-meta">
        {activeCompany.canton ?? '—'} · <span className="role-chip">{role ? ROLE_LABEL[role] : ''}</span>
      </div>
      {memberships.length > 1 && (
        <select
          className="select-inline"
          value={activeCompanyId ?? ''}
          onChange={(e) => setActiveCompany(e.target.value)}
          aria-label="Cambia azienda"
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
      <div className="account-actions">
        <button className="btn btn-sm" onClick={handleSignOut} disabled={busy} aria-label="Esci dall'account">
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="logout" className="ic-sm" />} Esci
        </button>
      </div>
    </div>
  );
}

export function AppShell() {
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
        <button className="hamburger" aria-label="Apri il menu di navigazione" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}>
          <Icon name="menu" />
        </button>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><Icon name="logo" /></div>
          <div className="brand-name">SwissAI Suite</div>
        </div>
      </header>

      {/* Sidebar (desktop) */}
      <aside className="sidebar" aria-label="Navigazione principale">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><Icon name="logo" /></div>
          <div>
            <div className="brand-name">SwissAI Suite</div>
            <div className="brand-sub">per le PMI svizzere</div>
          </div>
        </div>
        <CompanySwitch />
        <NavList />
        <AccountBox />
      </aside>

      {/* Drawer (mobile) */}
      <div className={`drawer-overlay${drawerOpen ? ' open' : ''}`} hidden={!drawerOpen} onClick={() => setDrawerOpen(false)} />
      <aside className={`drawer${drawerOpen ? ' open' : ''}`} aria-label="Menu di navigazione" aria-hidden={!drawerOpen}>
        <button className="drawer-close" aria-label="Chiudi il menu" onClick={() => setDrawerOpen(false)}><Icon name="close" /></button>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><Icon name="logo" /></div>
          <div>
            <div className="brand-name">SwissAI Suite</div>
            <div className="brand-sub">per le PMI svizzere</div>
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
