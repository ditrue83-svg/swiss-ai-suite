import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { RequireAuth, RequireCompany, RedirectIfAuthed } from '@/components/layout/guards';
import { AppShell } from '@/components/layout/AppShell';
import { Icon } from '@/components/ui/Icon';
import { BrandMark } from '@/components/ui/BrandMark';

import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { OnboardingPage } from '@/features/companies/OnboardingPage';
import { CompanySettingsPage } from '@/features/companies/CompanySettingsPage';
import { HomePage } from '@/features/dashboard/HomePage';
import { AssistantPage } from '@/features/assistant/AssistantPage';
import { TasksPage } from '@/features/tasks/TasksPage';
import { TaskDetailPage } from '@/features/tasks/TaskDetailPage';
import { CalendarPage } from '@/features/calendar/CalendarPage';
import { CalendarSettingsPage } from '@/features/calendar/CalendarSettingsPage';
import { InboxPage } from '@/features/inbox/InboxPage';
import { EmailAccountsPage } from '@/features/inbox/EmailAccountsPage';
import { AdminAIPage } from '@/features/admin-ai/AdminAIPage';
import { SubsidyPage } from '@/features/subsidy-ai/SubsidyPage';
import { IncentivesPage } from '@/features/incentives/IncentivesPage';
import { CatalogReviewPage } from '@/features/incentives/CatalogReviewPage';
import { DocumentsPage } from '@/features/documents/DocumentsPage';
import { DocumentDetailPage } from '@/features/documents/DocumentDetailPage';
import { FinancePage } from '@/features/finance/FinancePage';
import { FinanceDetailPage } from '@/features/finance/FinanceDetailPage';
import { ContractsPage } from '@/features/contracts/ContractsPage';
import { ClientsPage } from '@/features/crm/ClientsPage';
import { ClientCreatePage } from '@/features/crm/ClientCreatePage';
import { ClientDetailPage } from '@/features/crm/ClientDetailPage';
import { OpportunityCreatePage, OpportunityDetailPage } from '@/features/crm/OpportunityPages';
import { ContractDetailPage } from '@/features/contracts/ContractDetailPage';
import { ContractCreatePage } from '@/features/contracts/ContractCreatePage';
import { AutomationsPage } from '@/features/automations/AutomationsPage';
import { AutomationBuilderPage } from '@/features/automations/AutomationBuilderPage';
import { AutomationDetailPage } from '@/features/automations/AutomationDetailPage';
import { RunDetailPage } from '@/features/automations/RunDetailPage';
import { PricingPage } from '@/features/pricing/PricingPage';
import { PreferencesPage } from '@/features/settings/PreferencesPanel';
import { AuditLogPage } from '@/features/audit/AuditLogPage';
import { useT } from '@/i18n';

/**
 * Schermata mostrata quando l'app NON può funzionare per un problema di
 * configurazione. Due casi distinti, perché richiedono azioni diverse:
 *
 *   'missing'  — le variabili non ci sono. Tipico dello sviluppo locale.
 *   'rejected' — le variabili ci sono ma il server RIFIUTA la chiave. È il caso
 *                che nel deploy del 2026-07-26 è passato inosservato: l'app
 *                mostrava un accesso normale e falliva solo al primo tentativo,
 *                come se l'utente avesse sbagliato password. Qui si dice invece
 *                che il problema è dell'applicazione, non di chi la usa.
 */
function ConfigNeeded({ reason }: { reason: 'missing' | 'rejected' }) {
  const t = useT();
  return (
    <div className="centered-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark />
        </div>
        <div className="auth-title">
          {reason === 'rejected' ? t('states.configRejected') : t('states.configRequired')}
        </div>
        <div className="auth-sub">
          {reason === 'rejected' ? t('errors.configRejected') : t('errors.notConnected')}
        </div>
        <p className="muted-sm">
          {reason === 'rejected' ? t('states.configRejectedHint') : t('states.configRequiredHint')}
        </p>
        <div className="info-box mt-14">
          <Icon name="alert" className="ic-sm" /> {t('states.configNoData')}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { configStatus } = useAuth();
  // 'checking' e 'unreachable' NON bloccano: nel primo caso la verifica è ancora
  // in corso, nel secondo non sappiamo se la configurazione sia sbagliata — e un
  // allarme non fondato sarebbe esso stesso un dato inventato.
  if (configStatus === 'missing') return <ConfigNeeded reason="missing" />;
  if (configStatus === 'rejected') return <ConfigNeeded reason="rejected" />;

  return (
    <Routes>
      {/* Pubbliche (auth) */}
      <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
      <Route path="/register" element={<RedirectIfAuthed><RegisterPage /></RedirectIfAuthed>} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Protette */}
      <Route element={<RequireAuth />}>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route element={<RequireCompany />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />
            {/* La Dashboard è stata assorbita dalla Panoramica il 2026-07-28:
                rispondevano alla stessa domanda con gli stessi dati. Il vecchio
                indirizzo continua a funzionare perché sta nei segnalibri e
                negli appunti delle persone — stessa scelta di /scadenziario e
                /archivio. */}
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            {/* Chiedi ad AI-Swisse (0027). Sta accanto alla Panoramica e non
                fra i moduli: non è un decimo posto in cui il lavoro sta, è il
                modo di interrogare gli altri nove. Il contesto di una scheda
                arriva in `?su=tipo:id`, e il server lo verifica prima di usarlo. */}
            <Route path="/assistente" element={<AssistantPage />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/inbox/account" element={<EmailAccountsPage />} />
            <Route path="/attivita" element={<TasksPage />} />
            <Route path="/attivita/:id" element={<TaskDetailPage />} />
            {/* I vecchi collegamenti allo Scadenziario devono continuare a
                funzionare: sono in email, appunti e segnalibri delle persone.
                Reindirizzamento, non una seconda pagina da mantenere. */}
            <Route path="/scadenziario" element={<Navigate to="/attivita" replace />} />
            <Route path="/calendario" element={<CalendarPage />} />
            <Route path="/calendario/impostazioni" element={<CalendarSettingsPage />} />
            <Route path="/admin" element={<AdminAIPage />} />
            {/* INCENTIVI (Subsidy AI 2.0, 0032). Quattro schede, e la scheda
                viaggia in `?scheda=`: `/incentivi/pratiche` colliderebbe con
                un futuro `/incentivi/:id`, ed è la stessa scelta già fatta
                per la sezione delle Finanze. */}
            <Route path="/incentivi" element={<IncentivesPage />} />
            {/* ⚠️ Non è per i clienti: il cancello è nelle RPC della 0037, non qui.
                Una rotta nascosta non è un permesso — chi non è operatore del
                catalogo apre la pagina e legge perché non può decidere. */}
            <Route path="/incentivi/revisioni" element={<CatalogReviewPage />} />
            {/* ⚠️ La schermata 1.0 RESTA raggiungibile e non reindirizza, a
                differenza di `/scadenziario` e `/archivio`. La ragione è di
                merito: il 2.0 non copre ancora il profilo incentivi e
                l'interpretazione AI della descrizione, che vivono solo là.
                Reindirizzare porterebbe via una funzione senza sostituirla —
                e togliere prima di aver dato è il modo di far sparire lavoro
                senza accorgersene. La voce di menu punta al 2.0. */}
            <Route path="/subsidy" element={<SubsidyPage />} />
            <Route path="/documenti" element={<DocumentsPage />} />
            <Route path="/documenti/:id" element={<DocumentDetailPage />} />
            {/* L'Archivio è diventato Documenti. I vecchi collegamenti stanno
                in email, appunti e segnalibri delle persone: reindirizzamento,
                non una seconda pagina da mantenere. */}
            <Route path="/archivio" element={<Navigate to="/documenti" replace />} />
            {/* Finanze (0021). Il dettaglio NON è un secondo visualizzatore di
                documenti: il file resta del Document Hub e si apre là. La
                sezione (fatture / spese) viaggia in `?sezione=`, non nel
                percorso: `/finanze/spese` colliderebbe con `/finanze/:id`. */}
            <Route path="/finanze" element={<FinancePage />} />
            <Route path="/finanze/:id" element={<FinanceDetailPage />} />
            {/* I Contratti stanno dopo le Finanze perché ne condividono la
                natura: leggono documenti che il Document Hub custodisce già.
                ⚠️ `nuovo` PRIMA di `:id`, altrimenti react-router leggerebbe
                «nuovo» come un identificativo e la pagina di creazione non
                sarebbe raggiungibile. */}
            <Route path="/contratti" element={<ContractsPage />} />
            <Route path="/contratti/nuovo" element={<ContractCreatePage />} />
            <Route path="/contratti/:id" element={<ContractDetailPage />} />
            {/* Clienti (0026). Il CRM viene DOPO Contratti e Finanze perché
                collega ciò che quelle letture già nominano: la controparte di un
                contratto, il fornitore di una fattura, il mittente di un
                documento.
                ⚠️ `nuovo` PRIMA di `:id`, e `opportunita/nuova` PRIMA di
                `opportunita/:opportunityId`: con l'ordine inverso react-router
                leggerebbe «nuovo» come un identificativo e la pagina di
                creazione non sarebbe raggiungibile — senza dare errore. */}
            <Route path="/clienti" element={<ClientsPage />} />
            <Route path="/clienti/nuovo" element={<ClientCreatePage />} />
            <Route path="/clienti/:id/opportunita/nuova" element={<OpportunityCreatePage />} />
            <Route path="/clienti/:id/opportunita/:opportunityId" element={<OpportunityDetailPage />} />
            <Route path="/clienti/:id" element={<ClientDetailPage />} />
            {/* Automazioni (0020). Il generatore è la STESSA pagina per creare
                e per modificare: due moduli avrebbero significato due posti in
                cui ricordarsi della validazione e della frase riassuntiva. */}
            <Route path="/automazioni" element={<AutomationsPage />} />
            <Route path="/automazioni/nuova" element={<AutomationBuilderPage />} />
            <Route path="/automazioni/:id" element={<AutomationDetailPage />} />
            <Route path="/automazioni/:id/modifica" element={<AutomationBuilderPage />} />
            <Route path="/automazioni/:id/esecuzioni/:runId" element={<RunDetailPage />} />
            {/* Impostazioni azienda: i dati anagrafici (solo owner/admin, come
                vuole `companies_update_admin`) e il profilo operativo, che ogni
                membro può aggiornare. È anche l'unico posto in cui la ricerca
                nel Registro IDI resta utilizzabile dopo l'onboarding. */}
            <Route path="/azienda" element={<CompanySettingsPage />} />
            {/* Registro attività (0039): chi ha fatto che cosa, in ordine di
                tempo. ⚠️ Non è una rotta protetta da una guardia: il cancello è
                la policy `audit_select_admin`, e la pagina aperta da un membro
                spiega perché non può leggere invece di mostrare un elenco
                vuoto. Una rotta nascosta non è un permesso — stessa scelta di
                `/incentivi/revisioni`. */}
            <Route path="/registro" element={<AuditLogPage />} />
            <Route path="/prezzi" element={<PricingPage />} />
            {/* Le preferenze hanno un indirizzo proprio come ogni altra voce delle
                impostazioni: quello che si raggiunge solo aprendo una finestra non
                si può mandare a qualcuno in un collegamento. */}
            <Route path="/preferenze" element={<PreferencesPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
