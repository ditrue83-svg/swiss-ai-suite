// ============================================================================
// AppShell — layout autenticato: colonna laterale (desktop), barra in cima a
// OGNI larghezza (percorso, ricerca rapida ⌘K, pastiglia attenzione,
// campanella, caricamento) con cassetto di navigazione sul telefono,
// selettore azienda (multi-tenant ready), box account con "Esci".
// Riproduce fedelmente il layout/design del riferimento «panoramica-ai-swisse.html».
// ============================================================================
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { BrandMark } from '@/components/ui/BrandMark';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { NAV, NAV_SETTINGS, isSection, navItemMatches } from './nav';
import { CommandPalette } from './CommandPalette';
import { useAttentionCount } from './useAttentionCount';
import type { TKey } from '@/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { useToast } from '@/components/ui/Toast';
import { toUserMessage } from '@/lib/errors';
import { LEGACY_MODULES_ENABLED } from '@/lib/env';
import { useT, useTn } from '@/i18n';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ui/ThemeSwitcher';
import { NotificationBell, useUnreadCount } from '@/features/notifications/NotificationBell';
import { SettingsDialog } from '@/features/settings/SettingsDialog';

// I ruoli restano in chiave: l'etichetta si traduce al render.
const ROLE_KEY: Record<string, TKey> = { owner: 'roles.owner', admin: 'roles.admin', member: 'roles.member' };

function NavList({ onNavigate, onSettings, attentionCount = 0 }: { onNavigate?: () => void; onSettings: () => void; attentionCount?: number }) {
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
            {/* Il badge numerico del riferimento (2026-09-06): UNO SOLO, su
                «Documenti», ed è il conteggio condiviso della shell (vedi
                `useAttentionCount`): niente — come voleva nav.ts — una
                interrogazione per voce. A zero non si mostra: «niente da
                verificare» lo dice la pagina, non un distintivo. */}
            {entry.id === 'documents' && attentionCount > 0 && (
              <span className="nav-badge num" title={t('documents.states.to_verify')} aria-hidden="true">{attentionCount}</span>
            )}
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

function DataBox() {
  const t = useT();
  // Il riquadro di fiducia del riferimento «Panoramica» (2026-09-06): sta
  // fra la navigazione e la scheda utente, ed è una promessa del prodotto
  // scritta dove la si vede ogni giorno — non una voce, non un collegamento.
  return (
    <div className="data-box">
      <p className="data-box-title"><Icon name="shieldCheck" className="ic-sm" />{t('nav.dataBoxTitle')}</p>
      <p className="data-box-note">{t('nav.dataBoxNote')}</p>
    </div>
  );
}

/** Il percorso della pagina nella barra in cima (riferimento 2026-09-06):
 *  sezione › voce, la stessa struttura che la colonna laterale mostra — chi
 *  cambia formato non deve reimparare dove stanno le cose. La sezione è
 *  l'ultima intestazione vista scorrendo NAV fino alla voce che combacia;
 *  Panoramica e «Chiedi ad AI-Swisse» stanno PRIMA delle sezioni, quindi il
 *  loro percorso è il solo nome. Le voci nascoste (permessi, moduli fuori
 *  perimetro) non possono comparire qui: la regola è la stessa di NavList. */
function Breadcrumb() {
  const t = useT();
  const { isAdmin } = useCompany();
  const { pathname } = useLocation();

  let sezione: TKey | null = null;
  for (const entry of NAV) {
    if (isSection(entry)) { sezione = entry.sectionKey; continue; }
    if ((entry.adminOnly && !isAdmin) || (entry.legacyOnly && !LEGACY_MODULES_ENABLED)) continue;
    if (navItemMatches(entry, pathname)) {
      return (
        <nav className="crumbs" aria-label={t('nav.breadcrumbAria')}>
          {sezione === null ? (
            <span className="crumb-current">{t(entry.labelKey)}</span>
          ) : (
            <>
              <span>{t(sezione)}</span>
              <Icon name="chevronRight" />
              <span className="crumb-current">{t(entry.labelKey)}</span>
            </>
          )}
        </nav>
      );
    }
  }
  // Le pagine delle impostazioni non stanno in NAV: il loro percorso è
  // «Impostazioni › …», come la voce che le aprirebbe dalla colonna.
  const impostazione = NAV_SETTINGS.find((item) =>
    navItemMatches(item, pathname) && (!item.adminOnly || isAdmin) && (!item.legacyOnly || LEGACY_MODULES_ENABLED));
  if (!impostazione) return null;
  return (
    <nav className="crumbs" aria-label={t('nav.breadcrumbAria')}>
      <span>{t('nav.settings')}</span>
      <Icon name="chevronRight" />
      <span className="crumb-current">{t(impostazione.labelKey)}</span>
    </nav>
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
  const tn = useTn();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const { activeCompanyId } = useCompany();
  // Il conteggio vive QUI e non dentro la campanella: nell'albero la
  // campanella è UNA — dal 2026-09-06 sta solo nella barra in cima, che esiste
  // a ogni larghezza — ma prima erano due (una per formato, il CSS ne
  // nascondeva una) e due conteggi indipendenti avrebbero significato due
  // interrogazioni per caricamento, una per un pulsante che nessuno poteva
  // premere. La lezione resta: lo stato condiviso sta nell'unico posto in cui
  // c'è una sola copia di tutto.
  const { count, setCount } = useUnreadCount(activeCompanyId);
  // Il conteggio «da verificare»: uno solo per l'intera shell — pastiglia in
  // topbar e badge su «Documenti» — con la stessa cadenza della campanella.
  const attentionCount = useAttentionCount(activeCompanyId);
  // La finestra delle impostazioni vive QUI e non nei due NavList, per la
  // stessa ragione del conteggio della campanella: nell'albero i NavList sono
  // due — colonna e cassetto — e due finestre indipendenti vorrebbero dire due
  // riquadri modali possibili nello stesso documento. Identica ragione per la
  // ricerca rapida: UN mount, nella shell.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Chiudi il drawer al cambio pagina.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // ⌘K (o Ctrl+K fuori dal Mac) apre e chiude la ricerca rapida da OVUNQUE
  // nella shell: è il gesto che il campo della barra promette mostrando
  // «⌘K», e una promessa che funziona solo cliccando il campo sarebbe una
  // scorciatoia scritta e non data.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Esc chiude il cassetto, come già fa per la campanella e le finestre: un
  // pannello che si apre deve chiudersi anche da tastiera (riferimento
  // 2026-09-06: chiusura con tap fuori / Esc).
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // Blocca lo scroll del body quando il drawer è aperto.
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  return (
    <div className="app-shell">
      {/* Sidebar (desktop). Il landmark di navigazione è il <nav> interno,
          che si chiama «Navigazione principale»: dare lo stesso nome anche
          all'aside sarebbe annunciare due volte la stessa cosa. */}
      <aside className="sidebar">
        <div className="brand">
          {/* Nella shell la riga sotto il marchio è il CONTESTO («Spazio di
              lavoro», modello Lovable 2026-08-27), non il motto delle pagine
              di accesso: qui si è già entrati. Dal 2026-09-06 la campanella
              NON sta più qui accanto: il suo mount è UNO, nella barra in cima
              che esiste a ogni larghezza — prima erano due copie di cui il CSS
              ne nascondeva una. */}
          <BrandMark taglineKey="nav.workspace" caps />
        </div>
        <CompanySwitch />
        <NavList onSettings={() => setSettingsOpen(true)} attentionCount={attentionCount} />
        <DataBox />
        <AccountBox />
      </aside>

      {/* La colonna destra: la barra in cima + il contenuto. Dal 2026-09-06 la
          barra esiste a OGNI larghezza (riferimento «panoramica-ai-swisse.html»):
          percorso, ricerca rapida, pastiglia «richiede attenzione», campanella
          e caricamento. Su schermo stretto cambia mestiere — hamburger e
          marchio al posto di percorso e campo — ma resta lei. */}
      <div className="shell-body">
        <header className="topbar" role="banner">
          <button className="hamburger" aria-label={t('nav.openMenu')} aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}>
            <Icon name="menu" />
          </button>
          {/* Sul telefono il marchio sta fra l'hamburger e i comandi, dentro
              una barra di altezza fissa: la riga di sottotitolo la farebbe
              crescere in altezza, quindi qui non c'è. */}
          <div className="brand">
            <BrandMark tagline={false} />
          </div>
          <Breadcrumb />
          {/* Il campo che APRE la ricerca rapida: è un pulsante vestito da
              campo (il perché sta in app.css). Il «⌘K» è un'espressione JSX
              apposta: quel glifo non sta nei caratteri serviti, quindi non può
              vivere nei dizionari che fonts:check pesa. */}
          <button className="topbar-search" onClick={() => setPaletteOpen(true)} aria-label={t('palette.openAria')}>
            <Icon name="search" />
            <span className="topbar-search-text">{t('palette.placeholder')}</span>
            <kbd className="topbar-search-kbd" aria-hidden="true">{'⌘K'}</kbd>
          </button>
          <div className="topbar-actions">
            {/* La lente sola appare solo sotto i 900px, dove il campo non ci
                sta: apre la stessa ricerca. */}
            <button className="topbar-search-icon" onClick={() => setPaletteOpen(true)} aria-label={t('palette.openAria')}>
              <Icon name="search" />
            </button>
            {/* La pastiglia porta alla lista filtrata: il numero è DENTRO la
                frase («N documenti richiedono attenzione»), non un contatore a
                sé — così si legge da sola in tutte e tre le lingue. A zero non
                si mostra: «niente da verificare» non è un segnale. */}
            {attentionCount > 0 && (
              <Link className="topbar-attn" to="/documenti?stato=to_verify">
                <span className="attn-dot" aria-hidden="true"><span /><span /></span>
                <span className="num">{tn('home.attentionPill', attentionCount)}</span>
              </Link>
            )}
            {/* La campanella: mount UNICO della shell (dal 2026-09-06 — prima
                stava anche accanto al marchio della colonna). */}
            <NotificationBell count={count} setCount={setCount} />
            {/* La CTA del riferimento: porta ad «Analizza documento» con il
                modulo di caricamento già aperto (?carica=1 lo consuma la
                pagina). L'etichetta sparisce sotto i 600px, l'aria-label no. */}
            <Link className="btn btn-primary" to="/admin?carica=1" aria-label={t('home.uploadDoc')}>
              <Icon name="upload" className="ic-sm" />
              <span className="topbar-cta-label">{t('home.uploadDoc')}</span>
            </Link>
          </div>
        </header>

        {/* ⚠️ LA RETE STA QUI DENTRO, NON ATTORNO ALLA BARRA, e la posizione è
            la decisione: un guasto di una schermata deve lasciare in piedi la
            navigazione, il selettore azienda e l'uscita. Attorno a tutto avrebbe
            spento anche quelli, ed è esattamente la pagina bianca da cui veniamo.
            La chiave è il percorso: cambiata pagina, la rete si riarma. */}
        <main className="main">
          <ErrorBoundary chiave={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {/* Drawer (mobile) */}
      <div className={`drawer-overlay${drawerOpen ? ' open' : ''}`} hidden={!drawerOpen} onClick={() => setDrawerOpen(false)} />
      <aside className={`drawer${drawerOpen ? ' open' : ''}`} aria-label={t('nav.menu')} aria-hidden={!drawerOpen}>
        <button className="drawer-close" aria-label={t('nav.closeMenu')} onClick={() => setDrawerOpen(false)}><Icon name="close" /></button>
        <div className="brand">
          <BrandMark taglineKey="nav.workspace" caps />
        </div>
        <CompanySwitch />
        <NavList onNavigate={() => setDrawerOpen(false)} onSettings={() => setSettingsOpen(true)} attentionCount={attentionCount} />
        <DataBox />
        <AccountBox />
      </aside>

      {/* ⚠️ FUORI dalla rete di `ErrorBoundary`, come la navigazione: un guasto
          della schermata sotto non deve portarsi via le impostazioni — è da lì
          che si cambia lingua e si esce. Lo stesso per la ricerca rapida:
          cerca anche — anzi, soprattutto — quando una schermata è caduta.
          Un mount ciascuna, nella shell: mai una per formato. */}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
