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
import { HomePage } from '@/features/dashboard/HomePage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { ScadenziarioPage } from '@/features/tasks/ScadenziarioPage';
import { AdminAIPage } from '@/features/admin-ai/AdminAIPage';
import { SubsidyPage } from '@/features/subsidy-ai/SubsidyPage';
import { ArchivePage } from '@/features/archive/ArchivePage';
import { PricingPage } from '@/features/pricing/PricingPage';

function ConfigNeeded() {
  return (
    <div className="centered-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark" aria-hidden="true"><Icon name="logo" /></div>
          <div><div className="brand-name">SwissAI Suite</div><div className="brand-sub">per le PMI svizzere</div></div>
        </div>
        <div className="auth-title">Configurazione richiesta</div>
        <div className="auth-sub">L’app non è ancora collegata a Supabase.</div>
        <p className="muted-sm">
          Copia <code>.env.example</code> in <code>.env</code> e imposta <code>VITE_SUPABASE_URL</code> e
          <code> VITE_SUPABASE_ANON_KEY</code> con i valori del tuo progetto Supabase, poi riavvia il server di sviluppo.
        </p>
        <div className="info-box mt-14">
          <Icon name="alert" className="ic-sm" /> Nessun dato viene salvato finché la connessione non è configurata.
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { configured } = useAuth();
  if (!configured) return <ConfigNeeded />;

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
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/scadenziario" element={<ScadenziarioPage />} />
            <Route path="/admin" element={<AdminAIPage />} />
            <Route path="/subsidy" element={<SubsidyPage />} />
            <Route path="/archivio" element={<ArchivePage />} />
            <Route path="/prezzi" element={<PricingPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
