// ============================================================================
// PREFERENZE — lingua e aspetto, cioè le due scelte che riguardano CHI GUARDA
// e non l'azienda. Sono le uniche impostazioni personali del prodotto, e per
// questo aprono l'elenco: chi apre le impostazioni senza sapere che cosa cerca
// trova per prime le due che valgono per sé.
//
// ⚠️ SONO LE STESSE DUE TENDINE DEL PIEDE DELLA COLONNA, e la ripetizione è
// voluta: lì si cambia con un clic senza perdere di vista il lavoro, qui si
// trovano dove si vanno a cercare, con la loro etichetta scritta. È il patto
// della barra dei menu accanto alle preferenze di sistema.
// La ripetizione ha però un prezzo, ed è stato pagato: finché la preferenza
// dell'aspetto stava in uno `useState` del componente, due copie sullo schermo
// divergevano. Vedi `sottoscriviTema` in `lib/theme.ts`.
// ============================================================================
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ui/ThemeSwitcher';
import { useT } from '@/i18n';
import type { Sede } from '@/components/layout/nav';

export function PreferencesPanel({ sede }: { sede: Sede }) {
  const t = useT();
  return (
    <>
      <div className="page-head">
        {sede === 'pagina' && <div className="page-title">{t('nav.preferences')}</div>}
        <div className="page-desc">{t('settings.preferencesDesc')}</div>
      </div>
      <div className="card">
        <LanguageSwitcher />
        <ThemeSwitcher />
      </div>
    </>
  );
}

/** La rotta `/preferenze`: ogni voce delle impostazioni ha un indirizzo suo,
 *  perché un'impostazione che si raggiunge solo aprendo una finestra non si
 *  può mandare a qualcuno in un collegamento. */
export function PreferencesPage() {
  return <PreferencesPanel sede="pagina" />;
}
