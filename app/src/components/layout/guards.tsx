// Guardie di rotta: gli utenti non autenticati non accedono all'app interna;
// gli autenticati senza azienda vanno all'onboarding.
//
// ⚠️ LA DECISIONE NON È QUI: è in `routeGate.ts`, una funzione pura provata
//    offline. Questi componenti la RENDONO. Una guardia si sbaglia in silenzio
//    — non lancia, non colora niente di rosso, manda solo nel posto sbagliato —
//    ed è così che un indirizzo profondo aperto a freddo finiva sulla
//    Panoramica, passando per l'onboarding di chi un'azienda ce l'aveva già.
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { FullScreenLoader, ErrorState } from '@/components/ui/states';
import { routeGate } from './routeGate';
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
  const { loading, ready, error, hasCompany, refresh } = useCompany();
  const { loading: authLoading, session } = useAuth();

  const gate = routeGate({
    authLoading, hasSession: session !== null,
    companyReady: ready, companyLoading: loading,
    hasCompany, companyError: error,
  });

  if (gate === 'loading') return <FullScreenLoader label={t('states.loadingCompany')} />;
  if (gate === 'error') {
    return (
      <div className="centered-screen">
        <div className="auth-card"><ErrorState message={error ?? t('common.error')} onRetry={refresh} /></div>
      </div>
    );
  }
  // ⚠️ All'onboarding si va solo quando SAPPIAMO che non c'è un'azienda, mai
  //    «per intanto»: un reindirizzamento è irreversibile per l'indirizzo, e la
  //    rotta profonda con la sua query non torna più.
  if (gate === 'onboarding') return <Navigate to="/onboarding" replace />;
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
