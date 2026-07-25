// Guardie di rotta: gli utenti non autenticati non accedono all'app interna;
// gli autenticati senza azienda vanno all'onboarding.
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { FullScreenLoader, ErrorState } from '@/components/ui/states';
import { useT } from '@/i18n';

export function RequireAuth() {
  const t = useT();
  const { loading, session } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader label={t('states.verifyingSession')} />;
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

export function RequireCompany() {
  const t = useT();
  const { loading, error, hasCompany, refresh } = useCompany();
  if (loading) return <FullScreenLoader label={t('states.loadingCompany')} />;
  if (error) {
    return (
      <div className="centered-screen">
        <div className="auth-card"><ErrorState message={error} onRetry={refresh} /></div>
      </div>
    );
  }
  if (!hasCompany) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

/** Se l'utente è già loggato, tiene fuori dalle pagine di auth. */
export function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { loading, session } = useAuth();
  if (loading) return <FullScreenLoader label={t('states.loading')} />;
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}
