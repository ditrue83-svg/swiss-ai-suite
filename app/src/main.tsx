import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { CompanyProvider } from './contexts/CompanyContext';
import { ToastProvider } from './components/ui/Toast';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { I18nProvider } from './i18n';
import './styles/fonts.css';
import './styles/app.css';
import './styles/extra.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      {/* La lingua avvolge tutto: anche le schermate di errore e di caricamento
          mostrate prima dell'autenticazione devono essere tradotte. */}
      <I18nProvider>
        {/* ⚠️ LA SECONDA RETE, e non è un doppione. Quella di `AppShell` copre
            le schermate dentro la barra; questa copre ciò che sta FUORI —
            accesso, registrazione, reimposta password, e i provider stessi.
            Sta DENTRO I18nProvider perché la scheda di guasto è tradotta: fuori
            di lì `translate()` non avrebbe una lingua da usare. */}
        <ErrorBoundary>
          <ToastProvider>
            <AuthProvider>
              <CompanyProvider>
                <App />
              </CompanyProvider>
            </AuthProvider>
          </ToastProvider>
        </ErrorBoundary>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);
