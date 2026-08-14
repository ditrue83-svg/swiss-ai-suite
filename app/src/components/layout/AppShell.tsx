// ============================================================================
// AppShell — layout autenticato: sidebar desktop, topbar+drawer mobile,
// selettore azienda (multi-tenant ready), box account con "Esci".
// Riproduce fedelmente il layout/design del prototipo.
// ============================================================================
import { useEffect, useId, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { BrandMark } from '@/components/ui/BrandMark';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { NAV, NAV_SETTINGS, isSection, navItemMatches } from './nav';
import type { TKey } from '@/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { useToast } from '@/components/ui/Toast';
import { toUserMessage } from '@/lib/errors';
import { useT } from '@/i18n';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { NotificationBell, useUnreadCount } from '@/features/notifications/NotificationBell';

// I ruoli restano in chiave: l'etichetta si traduce al render.
const ROLE_KEY: Record<string, TKey> = { owner: 'roles.owner', admin: 'roles.admin', member: 'roles.member' };

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  // Le voci riservate spariscono per chi non è titolare o amministratore. Il
  // permesso però NON è questo: è la RLS della pagina (vedi nav.ts).
  const { isAdmin } = useCompany();
  const { pathname } = useLocation();
  // L'id del gruppo Impostazioni viene da useId perché nell'albero i NavList
  // sono DUE — colonna laterale e drawer — e un id scritto a mano sarebbe
  // duplicato nel documento.
  const settingsId = useId();
  // Il gruppo si apre da sé quando la pagina corrente ci abita: arrivare a
  // /azienda da una scorciatoia e trovare la propria voce invisibile sarebbe
  // una barra che mente. Resta uno stato locale: chiuderlo è sempre permesso.
  const inSettings = NAV_SETTINGS.some((item) => navItemMatches(item, pathname));
  const [settingsOpen, setSettingsOpen] = useState(inSettings);
  useEffect(() => { if (inSettings) setSettingsOpen(true); }, [inSettings]);

  return (
    <nav className="nav" aria-label={t('nav.mainNav')}>
      {NAV.filter((entry) => isSection(entry) || !entry.adminOnly || isAdmin).map((entry, i) =>
        isSection(entry) ? (
          <div className="nav-section" key={`s-${i}`}>{t(entry.sectionKey)}</div>
        ) : (
          <NavLink
            key={entry.id}
            to={entry.path}
            end={entry.path === '/'}
            // `navItemMatches` e non solo `isActive`: «Scadenze e attività»
            // resta accesa anche su /calendario (vedi nav.ts).
            className={({ isActive }) => `nav-btn${isActive || navItemMatches(entry, pathname) ? ' active' : ''}`}
            onClick={onNavigate}
          >
            <Icon name={entry.icon} />
            <span>{t(entry.labelKey)}</span>
          </NavLink>
        ),
      )}

      {/* IMPOSTAZIONI — in fondo, separato: ciò che si configura una volta
          non sta in mezzo al lavoro di ogni giorno (vedi nav.ts). */}
      <div className="nav-foot">
        <button
          className="nav-btn"
          aria-expanded={settingsOpen}
          aria-controls={settingsId}
          onClick={() => setSettingsOpen((v) => !v)}
        >
          <Icon name="settings" />
          <span>{t('nav.settings')}</span>
          <Icon name={settingsOpen ? 'arrowUp' : 'arrowDown'} className="ic-sm nav-caret" />
        </button>
        <div id={settingsId} hidden={!settingsOpen}>
          {NAV_SETTINGS.filter((item) => !item.adminOnly || isAdmin).map((item) => (
            <NavLink
              key={item.id}
              to={item.path}
              className={({ isActive }) => `nav-btn nav-subitem${isActive ? ' active' : ''}`}
              onClick={onNavigate}
            >
              <span>{t(item.labelKey)}</span>
            </NavLink>
          ))}
        </div>
      </div>
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
      <div className="mb-2"><LanguageSwitcher compact /></div>
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
  const { activeCompanyId } = useCompany();
  // Il conteggio vive QUI e non nelle campanelle: nell'albero ce ne sono due —
  // barra superiore per il telefono, colonna laterale per il desktop — e il CSS
  // ne nasconde una. Due conteggi indipendenti significherebbero due
  // interrogazioni per ogni caricamento, una delle quali per un pulsante che
  // nessuno può premere.
  const { count, setCount } = useUnreadCount(activeCompanyId);

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
        {/* Sul telefono il marchio sta fra l'hamburger e la campanella, dentro
            una barra di altezza fissa: la riga di sottotitolo la farebbe
            crescere in altezza, quindi qui non c'è. */}
        <div className="brand">
          <BrandMark tagline={false} />
        </div>
        {/* Su schermo stretto la campanella sta qui; su desktop questa barra è
            nascosta dal CSS e quella che si vede è nella colonna laterale. */}
        <NotificationBell count={count} setCount={setCount} />
      </header>

      {/* Sidebar (desktop). Il landmark di navigazione è il <nav> interno,
          che si chiama «Navigazione principale»: dare lo stesso nome anche
          all'aside sarebbe annunciare due volte la stessa cosa. */}
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <NotificationBell count={count} setCount={setCount} />
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
          <BrandMark />
        </div>
        <CompanySwitch />
        <NavList onNavigate={() => setDrawerOpen(false)} />
        <AccountBox />
      </aside>

      {/* ⚠️ LA RETE STA QUI DENTRO, NON ATTORNO ALLA BARRA, e la posizione è la
          decisione: un guasto di una schermata deve lasciare in piedi la
          navigazione, il selettore azienda e l'uscita. Attorno a tutto avrebbe
          spento anche quelli, ed è esattamente la pagina bianca da cui veniamo.
          La chiave è il percorso: cambiata pagina, la rete si riarma. */}
      <main className="main">
        <ErrorBoundary chiave={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
