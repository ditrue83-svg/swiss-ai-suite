// ============================================================================
// AppShell — layout autenticato: sidebar desktop, topbar+drawer mobile,
// selettore azienda (multi-tenant ready), box account con "Esci".
// Riproduce fedelmente il layout/design del prototipo.
// ============================================================================
import { useEffect, useState } from 'react';
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
import { LEGACY_MODULES_ENABLED } from '@/lib/env';
import { useT } from '@/i18n';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ui/ThemeSwitcher';
import { NotificationBell, useUnreadCount } from '@/features/notifications/NotificationBell';
import { SettingsDialog } from '@/features/settings/SettingsDialog';

// I ruoli restano in chiave: l'etichetta si traduce al render.
const ROLE_KEY: Record<string, TKey> = { owner: 'roles.owner', admin: 'roles.admin', member: 'roles.member' };

function NavList({ onNavigate, onSettings }: { onNavigate?: () => void; onSettings: () => void }) {
  const t = useT();
  // Le voci riservate spariscono per chi non è titolare o amministratore. Il
  // permesso però NON è questo: è la RLS della pagina (vedi nav.ts).
  const { isAdmin } = useCompany();
  const { pathname } = useLocation();
  // La voce resta ACCESA quando si è dentro una delle rotte delle impostazioni:
  // arrivare a /azienda da un segnalibro e trovare la barra che non lo dice
  // sarebbe una barra che mente. Era la stessa ragione per cui il gruppo si
  // apriva da sé, quando era un gruppo.
  const inSettings = NAV_SETTINGS.some((item) => navItemMatches(item, pathname));

  return (
    <nav className="nav" aria-label={t('nav.mainNav')}>
      {NAV.filter((entry) =>
        isSection(entry) || (!entry.adminOnly || isAdmin) && (!entry.legacyOnly || LEGACY_MODULES_ENABLED),
      ).map((entry, i) =>
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
          non sta in mezzo al lavoro di ogni giorno (vedi nav.ts).
          ⚠️ APRE UNA FINESTRA, non più un gruppo dentro la colonna. Il gruppo
          aggiungeva quattro voci — 124px — a una colonna che ne aveva 3,42 di
          margine, e proprio nel momento in cui si cerca qualcosa. `aria-haspopup`
          e i tre puntini dicono che il clic porta a un riquadro, non a una
          pagina: un pulsante che non lo dichiara è un pulsante che sorprende. */}
      <div className="nav-foot">
        <button
          className={`nav-btn${inSettings ? ' active' : ''}`}
          aria-haspopup="dialog"
          onClick={() => { onNavigate?.(); onSettings(); }}
        >
          <Icon name="settings" />
          <span>{t('nav.settings')}</span>
          <span className="nav-ellipsis" aria-hidden="true">…</span>
        </button>
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
      {/* Il titolo porta il nome INTERO: la riga lo tronca (vedi extra.css). */}
      <div className="cs-name" title={activeCompany.legalName}>{activeCompany.legalName}</div>
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
  const { activeCompany } = useCompany();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const name = profile && (profile.firstName || profile.lastName)
    ? `${profile.firstName} ${profile.lastName}`.trim()
    : (user?.email ?? 'Utente');
  const email = profile?.email ?? user?.email ?? '';
  const initials = (profile?.firstName?.[0] ?? '') + (profile?.lastName?.[0] ?? '') || (email[0] ?? 'U').toUpperCase();
  // Dal 2026-08-27 la seconda riga è l'AZIENDA, non l'email (modello Lovable):
  // chi guarda la barra conosce il proprio indirizzo — è il contesto in cui
  // sta lavorando che va tenuto davanti. Senza azienda attiva (shouldn't
  // happen dentro la shell, ma la rete può fallire) si torna all'email.
  const sotto = activeCompany
    ? `${activeCompany.legalName}${activeCompany.canton ? ` · ${activeCompany.canton}` : ''}`
    : email;

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
          <div className="account-sub" title={sotto}>{sotto}</div>
        </div>
      </div>
      {/* La lingua e l'aspetto si cambiano dove l'utente si aspetta le
          impostazioni personali. Sono due preferenze dello stesso genere — di
          chi guarda, su questo computer — e stanno insieme.
          ⚠️ SU UNA RIGA SOLA, con l'uscita, dal 2026-08-16. Erano tre righe
          impilate — due tendine a tutta larghezza e un pulsante — e il piede
          della colonna ne usciva alto 202px: misurato a 1280×720, la
          navigazione aveva 308px per 550 di voci e ne nascondeva 242, cioè
          tutto l'ARCHIVIO e le sue quattro voci. Tre comandi
          personali affiancati stanno in 28. La riduzione della colonna è
          questa, e la prova è la sezione 13 di test:shell-unit.
          L'uscita è la sola a perdere la propria etichetta: resta nel titolo
          (puntatore) e in aria-label (lettore di schermo), e nel drawer il
          bersaglio torna da dito. */}
      <div className="account-prefs">
        <LanguageSwitcher compact />
        <ThemeSwitcher compact />
        <button
          className="btn btn-sm"
          onClick={handleSignOut}
          disabled={busy}
          aria-label={t('nav.signOutAria')}
          title={t('nav.signOut')}
        >
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="logout" className="ic-sm" />}
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
  // La finestra delle impostazioni vive QUI e non nei due NavList, per la
  // stessa ragione del conteggio della campanella: nell'albero i NavList sono
  // due — colonna e cassetto — e due finestre indipendenti vorrebbero dire due
  // riquadri modali possibili nello stesso documento.
  const [settingsOpen, setSettingsOpen] = useState(false);

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
          {/* Nella shell la riga sotto il marchio è il CONTESTO («Spazio di
              lavoro», modello Lovable 2026-08-27), non il motto delle pagine
              di accesso: qui si è già entrati. */}
          <BrandMark taglineKey="nav.workspace" caps />
          <NotificationBell count={count} setCount={setCount} />
        </div>
        <CompanySwitch />
        <NavList onSettings={() => setSettingsOpen(true)} />
        <AccountBox />
      </aside>

      {/* Drawer (mobile) */}
      <div className={`drawer-overlay${drawerOpen ? ' open' : ''}`} hidden={!drawerOpen} onClick={() => setDrawerOpen(false)} />
      <aside className={`drawer${drawerOpen ? ' open' : ''}`} aria-label={t('nav.menu')} aria-hidden={!drawerOpen}>
        <button className="drawer-close" aria-label={t('nav.closeMenu')} onClick={() => setDrawerOpen(false)}><Icon name="close" /></button>
        <div className="brand">
          <BrandMark taglineKey="nav.workspace" caps />
        </div>
        <CompanySwitch />
        <NavList onNavigate={() => setDrawerOpen(false)} onSettings={() => setSettingsOpen(true)} />
        <AccountBox />
      </aside>

      {/* ⚠️ LA RETE STA QUI DENTRO, NON ATTORNO ALLA BARRA, e la posizione è la
          decisione: un guasto di una schermata deve lasciare in piedi la
          navigazione, il selettore azienda e l'uscita. Attorno a tutto avrebbe
          spento anche quelli, ed è esattamente la pagina bianca da cui veniamo.
          La chiave è il percorso: cambiata pagina, la rete si riarma. */}
      {/* ⚠️ FUORI dalla rete di `ErrorBoundary`, come la navigazione: un guasto
          della schermata sotto non deve portarsi via le impostazioni — è da lì
          che si cambia lingua e si esce. */}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <main className="main">
        <ErrorBoundary chiave={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
