import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { CompanyProvider } from './contexts/CompanyContext';
import { ToastProvider } from './components/ui/Toast';
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
        <ToastProvider>
          <AuthProvider>
            <CompanyProvider>
              <App />
            </CompanyProvider>
          </AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);
