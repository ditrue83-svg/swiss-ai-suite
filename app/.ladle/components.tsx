// ============================================================================
// Provider globale delle storie (Ladle, issue #85).
//
// I componenti di `src/components/ui` NON sono autosufficienti, e fingere che
// lo siano darebbe storie che mentono: lo stile vive in classi GLOBALI (i tre
// CSS dell'app, importati qui sotto), le stringhe passano da `useT()` e il
// Toast dal suo contesto. Questo provider dà a ogni storia lo stesso ambiente
// che l'AppShell dà alle schermate, così ciò che si vede al banco è ciò che
// si avrebbe in produzione.
// ============================================================================
import type { GlobalProvider } from '@ladle/react';
import '../src/styles/fonts.css';
import '../src/styles/app.css';
import '../src/styles/extra.css';
import { I18nProvider } from '../src/i18n';
import { ToastProvider } from '../src/components/ui/Toast';

export const Provider: GlobalProvider = ({ children }) => (
  <I18nProvider>
    <ToastProvider>
      {/* Superficie e respiro dell'app: senza, le storie starebbero attaccate
          al bordo della finestra su un fondo che non è quello del prodotto. */}
      <div style={{ background: 'var(--bg)', minHeight: '100vh', padding: 24 }}>{children}</div>
    </ToastProvider>
  </I18nProvider>
);
