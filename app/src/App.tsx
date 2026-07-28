import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { RequireAuth, RequireCompany, RedirectIfAuthed } from '@/components/layout/guards';
import { AppShell } from '@/components/layout/AppShell';
import { Icon } from '@/components/ui/Icon';

import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { OnboardingPage } from '@/features/companies/OnboardingPage';
import { CompanySettingsPage } from '@/features/companies/CompanySettingsPage';
import { HomePage } from '@/features/dashboard/HomePage';
import { TasksPage } from '@/features/tasks/TasksPage';
import { TaskDetailPage } from '@/features/tasks/TaskDetailPage';
import { CalendarPage } from '@/features/calendar/CalendarPage';
import { CalendarSettingsPage } from '@/features/calendar/CalendarSettingsPage';
import { InboxPage } from '@/features/inbox/InboxPage';
import { EmailAccountsPage } from '@/features/inbox/EmailAccountsPage';
import { AdminAIPage } from '@/features/admin-ai/AdminAIPage';
import { SubsidyPage } from '@/features/subsidy-ai/SubsidyPage';
import { DocumentsPage } from '@/features/documents/DocumentsPage';
import { DocumentDetailPage } from '@/features/documents/DocumentDetailPage';
import { FinancePage } from '@/features/finance/FinancePage';
import { FinanceDetailPage } from '@/features/finance/FinanceDetailPage';
import { AutomationsPage } from '@/features/automations/AutomationsPage';
import { AutomationBuilderPage } from '@/features/automations/AutomationBuilderPage';
import { AutomationDetailPage } from '@/features/automations/AutomationDetailPage';
import { RunDetailPage } from '@/features/automations/RunDetailPage';
import { PricingPage } from '@/features/pricing/PricingPage';
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
          <div className="brand-mark" aria-hidden="true"><Icon name="logo" /></div>
          <div><div className="brand-name">{t('brand.name')}</div><div className="brand-sub">{t('brand.tagline')}</div></div>
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
            <Route path="/prezzi" element={<PricingPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
